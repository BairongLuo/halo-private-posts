package run.halo.privateposts.router;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.content.ContentWrapper;
import run.halo.app.content.PostContentService;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.GroupVersion;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.MetadataOperator;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.service.PrivatePostBundleCryptoService;
import run.halo.privateposts.service.PasswordSlotCryptoService;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.service.SiteRecoveryKeyService;

@Configuration(proxyBeanMethods = false)
public class PrivatePostConsoleRouter implements CustomEndpoint {
    private static final GroupVersion API_VERSION = new GroupVersion("api.console.halo.run", "v1alpha1");
    private static final String PRIVATE_POST_BUNDLE_ANNOTATION = "privateposts.halo.run/bundle";
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        .findAndRegisterModules();
    private static final int BUNDLE_VERSION = 3;
    private static final String PAYLOAD_FORMAT_MARKDOWN = "markdown";
    private static final String PAYLOAD_FORMAT_HTML = "html";
    private static final String BUNDLE_CIPHER = "aes-256-gcm";
    private static final String BUNDLE_KDF = "envelope";
    private static final String PASSWORD_SLOT_KDF = "scrypt";
    private static final String SITE_RECOVERY_KID = "site-recovery-rsa-oaep-sha256-v1";
    private static final String SITE_RECOVERY_ALGORITHM = "RSA-OAEP-256";
    private static final int AES_GCM_IV_BYTES = 12;
    private static final int AES_GCM_AUTH_TAG_BYTES = 16;
    private static final int PASSWORD_SLOT_SALT_BYTES = 16;
    private static final int CONTENT_KEY_BYTES = 32;
    private static final int SITE_RECOVERY_WRAPPED_CEK_BYTES = 384;
    private static final int MIN_CONTENT_CIPHERTEXT_BYTES = 16;

    private final SiteRecoveryKeyService siteRecoveryKeyService;
    private final PasswordSlotCryptoService passwordSlotCryptoService;
    private final PrivatePostBundleCryptoService privatePostBundleCryptoService;
    private final PrivatePostService privatePostService;
    private final PostContentService postContentService;
    private final ReactiveExtensionClient client;

    public PrivatePostConsoleRouter(SiteRecoveryKeyService siteRecoveryKeyService,
                                    PasswordSlotCryptoService passwordSlotCryptoService,
                                    PrivatePostBundleCryptoService privatePostBundleCryptoService,
                                    PrivatePostService privatePostService,
                                    PostContentService postContentService,
                                    ReactiveExtensionClient client) {
        this.siteRecoveryKeyService = siteRecoveryKeyService;
        this.passwordSlotCryptoService = passwordSlotCryptoService;
        this.privatePostBundleCryptoService = privatePostBundleCryptoService;
        this.privatePostService = privatePostService;
        this.postContentService = postContentService;
        this.client = client;
    }

    @Override
    @Bean
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .GET("/private-posts/site-recovery-key", this::getSiteRecoveryKey)
            .POST("/private-posts/refresh-bundle", this::refreshBundleWithSiteRecovery)
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
                        PrivatePost.Bundle bundle = requireBundleFromSourcePost(sourcePost);
                        PrivatePost.SiteRecoverySlot siteRecoverySlot = bundle.getSiteRecoverySlot();
                        if (siteRecoverySlot == null || !StringUtils.hasText(siteRecoverySlot.getWrappedCek())) {
                            return Mono.error(new IllegalArgumentException("当前文章还没有平台恢复槽，不能直接后台重置口令"));
                        }

                        try {
                            validateSiteRecoverySlot(siteRecoverySlot);
                        } catch (IllegalArgumentException error) {
                            return Mono.error(new IllegalArgumentException(
                                "当前文章的私密正文 bundle 无效，请重新加锁后再使用平台恢复",
                                error
                            ));
                        }
                        return siteRecoveryKeyService.unwrap(
                                hexToBytes(siteRecoverySlot.getWrappedCek())
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

    private Mono<ServerResponse> refreshBundleWithSiteRecovery(ServerRequest request) {
        return requireConsoleAdmin()
            .then(request.bodyToMono(SiteRecoveryRefreshRequest.class))
            .flatMap(body -> {
                if (!StringUtils.hasText(body.postName())) {
                    return ServerResponse.badRequest()
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(Map.of("message", "postName 不能为空"));
                }

                return client.fetch(Post.class, body.postName())
                    .switchIfEmpty(Mono.error(new IllegalArgumentException("未找到对应的源文章")))
                    .flatMap(sourcePost -> {
                        PrivatePost.Bundle bundle = requireBundleFromSourcePost(sourcePost);
                        PrivatePost.SiteRecoverySlot siteRecoverySlot = bundle.getSiteRecoverySlot();
                        if (siteRecoverySlot == null || !StringUtils.hasText(siteRecoverySlot.getWrappedCek())) {
                            return Mono.error(new IllegalArgumentException("当前文章还没有平台恢复槽，不能直接刷新密文"));
                        }

                        PrivatePost.BundleMetadata metadata = body.metadata() == null
                            ? bundle.getMetadata()
                            : body.metadata().toBundleMetadata();
                        try {
                            validateSiteRecoverySlot(siteRecoverySlot);
                        } catch (IllegalArgumentException error) {
                            return Mono.error(new IllegalArgumentException(
                                "当前文章的私密正文 bundle 无效，请重新加锁后再使用平台恢复",
                                error
                            ));
                        }

                        return resolveRefreshDocument(body)
                            .flatMap(document -> siteRecoveryKeyService.unwrap(hexToBytes(siteRecoverySlot.getWrappedCek()))
                                .map(contentKey -> privatePostBundleCryptoService.reencryptWithContentKey(
                                    bundle,
                                    contentKey,
                                    document.payloadFormat(),
                                    document.content(),
                                    metadata
                                )))
                            .flatMap(nextBundle -> {
                                PrivatePost privatePost = new PrivatePost();
                                syncPrivatePostSpecFromSource(privatePost, sourcePost, nextBundle);

                                return persistBundleToSourcePost(sourcePost, nextBundle)
                                    .then(privatePostService.upsert(privatePost))
                                    .then(ServerResponse.ok()
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .bodyValue(Map.of(
                                            "message", "私密正文密文已按最新正文同步更新",
                                            "bundle", nextBundle
                                        )));
                            });
                    });
            })
            .onErrorResume(AccessDeniedException.class, this::forbiddenResponse)
            .onErrorResume(IllegalArgumentException.class, error -> ServerResponse.badRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("message", error.getMessage())))
            .onErrorResume(IllegalStateException.class, this::internalServerErrorResponse);
    }

    private Mono<RefreshDocument> resolveRefreshDocument(SiteRecoveryRefreshRequest request) {
        if (StringUtils.hasText(request.payloadFormat()) && StringUtils.hasText(request.content())) {
            return Mono.just(new RefreshDocument(request.payloadFormat().trim(), request.content()));
        }

        return postContentService.getHeadContent(request.postName())
            .switchIfEmpty(Mono.error(new IllegalArgumentException("当前无法读取已保存正文，请刷新编辑页后重试")))
            .map(this::toRefreshDocument);
    }

    private RefreshDocument toRefreshDocument(ContentWrapper contentWrapper) {
        if (contentWrapper == null) {
            throw new IllegalArgumentException("当前无法读取已保存正文，请刷新编辑页后重试");
        }

        String raw = contentWrapper.getRaw() == null ? "" : contentWrapper.getRaw().trim();
        String rendered = contentWrapper.getContent() == null ? "" : contentWrapper.getContent().trim();
        String rawType = contentWrapper.getRawType() == null ? "" : contentWrapper.getRawType().trim().toLowerCase();
        String content = StringUtils.hasText(raw) ? contentWrapper.getRaw() : contentWrapper.getContent();

        if (!StringUtils.hasText(content)) {
            throw new IllegalArgumentException("当前文章还没有正文内容，请先输入正文后再保存");
        }

        if (!StringUtils.hasText(rawType) || PAYLOAD_FORMAT_MARKDOWN.equals(rawType) || "md".equals(rawType)) {
            return new RefreshDocument(PAYLOAD_FORMAT_MARKDOWN, content);
        }

        if (PAYLOAD_FORMAT_HTML.equals(rawType) || "htm".equals(rawType) || rawType.contains(PAYLOAD_FORMAT_HTML)) {
            return new RefreshDocument(PAYLOAD_FORMAT_HTML, content);
        }

        if (!StringUtils.hasText(raw) && StringUtils.hasText(rendered)) {
            return new RefreshDocument(PAYLOAD_FORMAT_HTML, contentWrapper.getContent());
        }

        throw new IllegalArgumentException(
            "当前正文类型为 " + contentWrapper.getRawType() + "，暂时只支持 Markdown 或 HTML 正文加锁"
        );
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
            PRIVATE_POST_BUNDLE_ANNOTATION,
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

    private PrivatePost.Bundle requireBundleFromSourcePost(Post sourcePost) {
        if (sourcePost == null || sourcePost.getMetadata() == null) {
            throw new IllegalArgumentException("当前文章还没有有效的私密正文 bundle，请重新加锁后再使用平台恢复");
        }

        Map<String, String> annotations = sourcePost.getMetadata().getAnnotations();
        String bundleText = annotations == null ? null : annotations.get(PRIVATE_POST_BUNDLE_ANNOTATION);
        if (!StringUtils.hasText(bundleText)) {
            throw new IllegalArgumentException("当前文章还没有有效的私密正文 bundle，请重新加锁后再使用平台恢复");
        }

        try {
            PrivatePost.Bundle bundle = OBJECT_MAPPER.readValue(bundleText, PrivatePost.Bundle.class);
            validateBundleForPasswordReset(bundle);
            return bundle;
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("当前文章的私密正文 bundle 无效，请重新加锁后再使用平台恢复", error);
        } catch (IllegalArgumentException error) {
            String message = error.getMessage();
            if ("site_recovery_slot 缺失".equals(message) || "site_recovery_slot.wrapped_cek 不能为空".equals(message)) {
                throw new IllegalArgumentException("当前文章还没有平台恢复槽，不能直接后台重置口令", error);
            }
            throw new IllegalArgumentException("当前文章的私密正文 bundle 无效，请重新加锁后再使用平台恢复", error);
        }
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

    private static void validateBundleForPasswordReset(@Nullable PrivatePost.Bundle bundle) {
        if (bundle == null) {
            throw new IllegalArgumentException("Bundle 缺失");
        }

        if (bundle.getVersion() == null || bundle.getVersion() != BUNDLE_VERSION) {
            throw new IllegalArgumentException("只支持 v3 私密正文 bundle");
        }

        String payloadFormat = requireText(bundle.getPayloadFormat(), "payload_format").trim().toLowerCase();
        if (!PAYLOAD_FORMAT_MARKDOWN.equals(payloadFormat) && !PAYLOAD_FORMAT_HTML.equals(payloadFormat)) {
            throw new IllegalArgumentException("当前 bundle 的 payload_format 不受支持");
        }

        if (!BUNDLE_CIPHER.equals(requireText(bundle.getCipher(), "cipher"))
            || !BUNDLE_KDF.equals(requireText(bundle.getKdf(), "kdf"))) {
            throw new IllegalArgumentException("当前 bundle 的算法组合不受支持");
        }

        requireHexExact(bundle.getDataIv(), AES_GCM_IV_BYTES, "data_iv");
        requireHexAtLeast(bundle.getCiphertext(), MIN_CONTENT_CIPHERTEXT_BYTES, "ciphertext");
        requireHexExact(bundle.getAuthTag(), AES_GCM_AUTH_TAG_BYTES, "auth_tag");
        validatePasswordSlot(bundle.getPasswordSlot());
        validateMetadata(bundle.getMetadata());
    }

    private static void validatePasswordSlot(@Nullable PrivatePost.PasswordSlot passwordSlot) {
        if (passwordSlot == null) {
            throw new IllegalArgumentException("password_slot 缺失");
        }

        if (!PASSWORD_SLOT_KDF.equals(requireText(passwordSlot.getKdf(), "password_slot.kdf"))) {
            throw new IllegalArgumentException("当前 bundle 的 password slot 算法不受支持");
        }

        requireHexExact(passwordSlot.getSalt(), PASSWORD_SLOT_SALT_BYTES, "password_slot.salt");
        requireHexExact(passwordSlot.getWrapIv(), AES_GCM_IV_BYTES, "password_slot.wrap_iv");
        requireHexExact(passwordSlot.getWrappedCek(), CONTENT_KEY_BYTES, "password_slot.wrapped_cek");
        requireHexExact(passwordSlot.getAuthTag(), AES_GCM_AUTH_TAG_BYTES, "password_slot.auth_tag");
    }

    private static void validateSiteRecoverySlot(@Nullable PrivatePost.SiteRecoverySlot siteRecoverySlot) {
        if (siteRecoverySlot == null) {
            throw new IllegalArgumentException("site_recovery_slot 缺失");
        }

        if (!SITE_RECOVERY_KID.equals(requireText(siteRecoverySlot.getKid(), "site_recovery_slot.kid"))) {
            throw new IllegalArgumentException("当前 bundle 的平台恢复 kid 不受支持");
        }

        if (!SITE_RECOVERY_ALGORITHM.equals(requireText(siteRecoverySlot.getAlg(), "site_recovery_slot.alg"))) {
            throw new IllegalArgumentException("当前 bundle 的平台恢复算法不受支持");
        }

        requireHexExact(siteRecoverySlot.getWrappedCek(), SITE_RECOVERY_WRAPPED_CEK_BYTES,
            "site_recovery_slot.wrapped_cek");
    }

    private static void validateMetadata(@Nullable PrivatePost.BundleMetadata metadata) {
        if (metadata == null) {
            throw new IllegalArgumentException("metadata 缺失");
        }

        requireText(metadata.getSlug(), "metadata.slug");
        requireText(metadata.getTitle(), "metadata.title");
    }

    private static void requireHexExact(@Nullable String value, int expectedBytes, String fieldName) {
        requireHex(value, fieldName);
        if ((value.trim().length() / 2) != expectedBytes) {
            throw new IllegalArgumentException(fieldName + " 长度非法");
        }
    }

    private static void requireHexAtLeast(@Nullable String value, int minimumBytes, String fieldName) {
        requireHex(value, fieldName);
        if ((value.trim().length() / 2) < minimumBytes) {
            throw new IllegalArgumentException(fieldName + " 长度非法");
        }
    }

    private static void requireHex(@Nullable String value, String fieldName) {
        String normalized = requireText(value, fieldName).trim();
        if ((normalized.length() % 2) != 0) {
            throw new IllegalArgumentException(fieldName + " 长度非法");
        }

        for (int index = 0; index < normalized.length(); index += 1) {
            if (Character.digit(normalized.charAt(index), 16) < 0) {
                throw new IllegalArgumentException(fieldName + " 不是合法 hex");
            }
        }
    }

    private static String requireText(@Nullable String value, String fieldName) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException(fieldName + " 不能为空");
        }
        return value;
    }

    private record SiteRecoveryResetRequest(String postName, String nextPassword) {
    }

    private record SiteRecoveryRefreshRequest(String postName,
                                              @Nullable String payloadFormat,
                                              @Nullable String content,
                                              @Nullable BundleMetadataPayload metadata) {
    }

    private record BundleMetadataPayload(String slug,
                                         String title,
                                         @Nullable String excerpt,
                                         @Nullable String publishedAt) {
        private PrivatePost.BundleMetadata toBundleMetadata() {
            if (!StringUtils.hasText(slug) || !StringUtils.hasText(title)) {
                throw new IllegalArgumentException("metadata.slug 和 metadata.title 不能为空");
            }

            PrivatePost.BundleMetadata metadata = new PrivatePost.BundleMetadata();
            metadata.setSlug(slug.trim());
            metadata.setTitle(title.trim());
            metadata.setExcerpt(StringUtils.hasText(excerpt) ? excerpt.trim() : null);
            metadata.setPublishedAt(StringUtils.hasText(publishedAt) ? publishedAt.trim() : null);
            return metadata;
        }
    }

    private record RefreshDocument(String payloadFormat, String content) {
    }
}
