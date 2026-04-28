package run.halo.privateposts.router;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.GroupVersion;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.MetadataOperator;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.model.PrivatePostBundleValidator;
import run.halo.privateposts.service.PasswordSlotCryptoService;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.service.SiteRecoveryKeyService;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

@Configuration(proxyBeanMethods = false)
public class PrivatePostConsoleRouter implements CustomEndpoint {
    private static final GroupVersion API_VERSION = new GroupVersion("api.console.halo.run", "v1alpha1");
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        .findAndRegisterModules();

    private final SiteRecoveryKeyService siteRecoveryKeyService;
    private final PasswordSlotCryptoService passwordSlotCryptoService;
    private final PrivatePostService privatePostService;
    private final ReactiveExtensionClient client;

    public PrivatePostConsoleRouter(SiteRecoveryKeyService siteRecoveryKeyService,
                                    PasswordSlotCryptoService passwordSlotCryptoService,
                                    PrivatePostService privatePostService,
                                    ReactiveExtensionClient client) {
        this.siteRecoveryKeyService = siteRecoveryKeyService;
        this.passwordSlotCryptoService = passwordSlotCryptoService;
        this.privatePostService = privatePostService;
        this.client = client;
    }

    @Override
    @Bean
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .GET("/private-posts/site-recovery-key", this::getSiteRecoveryKey)
            .POST("/private-posts/reset-password", this::resetPasswordWithSiteRecovery)
            .build();
    }

    @Override
    public GroupVersion groupVersion() {
        return API_VERSION;
    }

    private Mono<ServerResponse> getSiteRecoveryKey(ServerRequest request) {
        return requireConsoleAdmin().then(siteRecoveryKeyService.ensurePublicKey()
            .flatMap(publicKey -> ServerResponse.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of(
                    "kid", publicKey.kid(),
                    "alg", publicKey.alg(),
                    "publicKey", publicKey.publicKey()
                ))))
            .onErrorResume(AccessDeniedException.class, this::forbiddenResponse)
            .onErrorResume(IllegalStateException.class, this::internalServerErrorResponse);
    }

    private Mono<ServerResponse> resetPasswordWithSiteRecovery(ServerRequest request) {
        return requireConsoleAdmin()
            .then(request.bodyToMono(SiteRecoveryResetRequest.class))
            .flatMap(body -> {
                if (!StringUtils.hasText(body.postName()) || !StringUtils.hasText(body.nextPassword())) {
                    return ServerResponse.badRequest().bodyValue(Map.of("message", "postName 和 nextPassword 不能为空"));
                }

                return client.fetch(Post.class, body.postName())
                    .switchIfEmpty(Mono.error(new IllegalArgumentException("未找到对应的源文章")))
                    .flatMap(sourcePost -> {
                        PrivatePost.Bundle bundle = readBundleFromSourcePost(sourcePost);
                        if (bundle == null) {
                            return Mono.error(new IllegalArgumentException("当前文章还没有有效的私密正文 bundle，请重新加锁后再使用平台恢复"));
                        }

                        try {
                            PrivatePostBundleValidator.validate(bundle);
                        } catch (IllegalArgumentException error) {
                            return Mono.error(new IllegalArgumentException("当前文章的私密正文 bundle 无效，请重新加锁后再使用平台恢复"));
                        }

                        if (bundle.getSiteRecoverySlot() == null) {
                            return Mono.error(new IllegalArgumentException("当前文章还没有平台恢复槽，不能直接后台重置口令"));
                        }

                        return siteRecoveryKeyService.unwrap(
                                hexToBytes(bundle.getSiteRecoverySlot().getWrappedCek())
                            )
                            .flatMap(contentKey -> {
                                bundle.setPasswordSlot(passwordSlotCryptoService.wrapContentKey(
                                    contentKey,
                                    body.nextPassword()
                                ));
                                PrivatePost privatePost = new PrivatePost();
                                syncPrivatePostSpecFromSource(privatePost, sourcePost, bundle);

                                return persistBundleToSourcePost(sourcePost, bundle)
                                    .then(privatePostService.upsert(privatePost))
                                    .then(ServerResponse.ok()
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .bodyValue(Map.of("message", "访问口令已通过平台恢复能力重置")));
                            });
                    });
            })
            .onErrorResume(AccessDeniedException.class, this::forbiddenResponse)
            .onErrorResume(IllegalArgumentException.class, error -> ServerResponse.badRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("message", error.getMessage())))
            .onErrorResume(IllegalStateException.class, this::internalServerErrorResponse);
    }

    private Mono<Void> requireConsoleAdmin() {
        return ReactiveSecurityContextHolder.getContext()
            .map(context -> context.getAuthentication())
            .filter(Authentication::isAuthenticated)
            .switchIfEmpty(Mono.error(new AccessDeniedException("当前用户没有平台恢复权限")))
            .then();
    }

    private Mono<Void> persistBundleToSourcePost(Post post, PrivatePost.Bundle bundle) {
        mutateBundleAnnotation(post, bundle);
        return client.update(post).then();
    }

    private void mutateBundleAnnotation(Post post, PrivatePost.Bundle bundle) {
        Metadata metadata = copyMetadata(post.getMetadata());
        if (metadata == null) {
            throw new IllegalArgumentException("源文章元数据缺失");
        }

        Map<String, String> annotations = metadata.getAnnotations() == null
            ? new LinkedHashMap<>()
            : new LinkedHashMap<>(metadata.getAnnotations());
        annotations.put(
            PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
            writeBundleText(bundle)
        );
        metadata.setAnnotations(annotations);
        post.setMetadata(metadata);
    }

    private void syncPrivatePostSpecFromSource(PrivatePost privatePost, Post sourcePost, PrivatePost.Bundle bundle) {
        PrivatePost.PrivatePostSpec spec = privatePost.getSpec();
        if (spec == null) {
            spec = new PrivatePost.PrivatePostSpec();
            privatePost.setSpec(spec);
        }

        if (sourcePost.getMetadata() != null && StringUtils.hasText(sourcePost.getMetadata().getName())) {
            spec.setPostName(sourcePost.getMetadata().getName());
        }
        if (sourcePost.getSpec() != null) {
            spec.setSlug(sourcePost.getSpec().getSlug());
            spec.setTitle(sourcePost.getSpec().getTitle());
            spec.setExcerpt(readExcerpt(sourcePost));
            spec.setPublishedAt(readPublishedAt(sourcePost.getSpec().getPublishTime()));
        }
        spec.setBundle(bundle);
    }

    private PrivatePost.Bundle readBundleFromSourcePost(Post sourcePost) {
        if (sourcePost == null || sourcePost.getMetadata() == null) {
            return null;
        }

        return PostPrivatePostSyncListener.readBundleFromAnnotations(
            sourcePost.getMetadata().getName(),
            sourcePost.getMetadata().getAnnotations()
        );
    }

    private String writeBundleText(PrivatePost.Bundle bundle) {
        try {
            return OBJECT_MAPPER.writeValueAsString(bundle);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("平台恢复后写回 bundle 失败", error);
        }
    }

    private Mono<ServerResponse> forbiddenResponse(AccessDeniedException error) {
        return ServerResponse.status(403)
            .contentType(MediaType.APPLICATION_JSON)
            .bodyValue(Map.of("message", error.getMessage()));
    }

    private Mono<ServerResponse> internalServerErrorResponse(IllegalStateException error) {
        return ServerResponse.status(500)
            .contentType(MediaType.APPLICATION_JSON)
            .bodyValue(Map.of("message", error.getMessage()));
    }

    private static String readExcerpt(Post post) {
        if (post.getSpec() != null
            && post.getSpec().getExcerpt() != null
            && StringUtils.hasText(post.getSpec().getExcerpt().getRaw())) {
            return post.getSpec().getExcerpt().getRaw();
        }

        if (post.getStatus() != null && StringUtils.hasText(post.getStatus().getExcerpt())) {
            return post.getStatus().getExcerpt();
        }

        return null;
    }

    private static String readPublishedAt(Instant publishTime) {
        return publishTime == null ? null : publishTime.toString();
    }

    private static Metadata copyMetadata(MetadataOperator metadata) {
        if (metadata == null) {
            return null;
        }

        Metadata copied = new Metadata();
        copied.setName(metadata.getName());
        copied.setGenerateName(metadata.getGenerateName());
        copied.setLabels(copyMap(metadata.getLabels()));
        copied.setAnnotations(copyMap(metadata.getAnnotations()));
        copied.setVersion(metadata.getVersion());
        copied.setCreationTimestamp(metadata.getCreationTimestamp());
        copied.setDeletionTimestamp(metadata.getDeletionTimestamp());
        copied.setFinalizers(copySet(metadata.getFinalizers()));
        return copied;
    }

    private static Map<String, String> copyMap(Map<String, String> source) {
        return source == null ? null : new LinkedHashMap<>(source);
    }

    private static Set<String> copySet(Set<String> source) {
        return source == null ? null : new LinkedHashSet<>(source);
    }

    private static byte[] hexToBytes(String value) {
        String hex = value == null ? "" : value.trim();
        if (hex.isEmpty() || (hex.length() % 2) != 0) {
            throw new IllegalArgumentException("平台恢复槽格式非法");
        }

        byte[] result = new byte[hex.length() / 2];
        for (int index = 0; index < hex.length(); index += 2) {
            result[index / 2] = (byte) Integer.parseInt(hex.substring(index, index + 2), 16);
        }
        return result;
    }

    private record SiteRecoveryResetRequest(String postName, String nextPassword) {
    }
}
