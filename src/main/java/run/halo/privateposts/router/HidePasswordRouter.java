package run.halo.privateposts.router;

import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.content.PostContentService;
import run.halo.app.core.extension.content.Post;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.extension.GroupVersion;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.privateposts.service.HidePasswordService;

/**
 * 公开的密码校验端点。读者输入密码后，服务端用文章注解里的 PBKDF2 hash 校验，
 * 通过则返回该文章所有 hide-password 段的内容（原文），由前端渲染。
 */
@Configuration(proxyBeanMethods = false)
public class HidePasswordRouter implements CustomEndpoint {
    private static final GroupVersion API_VERSION =
        new GroupVersion("api.privateposts.halo.run", "v1alpha1");

    private final ReactiveExtensionClient client;
    private final PostContentService postContentService;
    private final HidePasswordService hidePasswordService;

    public HidePasswordRouter(ReactiveExtensionClient client,
                              PostContentService postContentService,
                              HidePasswordService hidePasswordService) {
        this.client = client;
        this.postContentService = postContentService;
        this.hidePasswordService = hidePasswordService;
    }

    @Bean
    @Override
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .POST("/hide-password/verify", this::verify)
            .build();
    }

    @Override
    public GroupVersion groupVersion() {
        return API_VERSION;
    }

    private Mono<ServerResponse> verify(ServerRequest request) {
        return request.bodyToMono(VerifyRequest.class)
            .switchIfEmpty(Mono.error(new IllegalArgumentException("请求内容不能为空")))
            .flatMap(body -> {
                if (!StringUtils.hasText(body.postName()) || !StringUtils.hasText(body.password())) {
                    return ServerResponse.badRequest()
                        .bodyValue(Map.of("message", "postName 和 password 不能为空"));
                }

                return client.fetch(Post.class, body.postName())
                    .flatMap(post -> {
                        // 公开解锁端点不能绕过 Halo 的发布状态和可见性规则。
                        if (!post.isPublished() || post.getSpec() == null
                            || !Post.isPublic(post.getSpec())) {
                            return unauthorized();
                        }
                        String configJson = hidePasswordService.readPasswordConfig(post);
                        if (!hidePasswordService.verify(body.password(), configJson)) {
                            return unauthorized();
                        }

                        return postContentService.getReleaseContent(body.postName())
                            .map(contentWrapper -> contentWrapper.getContent())
                            .map(hidePasswordService::parseHiddenSegments)
                            .flatMap(segments -> ServerResponse.ok()
                                .contentType(MediaType.APPLICATION_JSON)
                                .bodyValue(Map.of("segments", segments)));
                    })
                    .switchIfEmpty(unauthorized());
            })
            .onErrorResume(IllegalArgumentException.class, error -> ServerResponse.badRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("message", error.getMessage())));
    }

    private Mono<ServerResponse> unauthorized() {
        return ServerResponse.status(HttpStatus.UNAUTHORIZED)
            .contentType(MediaType.APPLICATION_JSON)
            .bodyValue(Map.of("message", "访问密码错误"));
    }

    private record VerifyRequest(String postName, String password) {
    }
}
