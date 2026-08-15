package run.halo.privateposts.router;

import java.util.Map;
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
import run.halo.app.extension.GroupVersion;
import run.halo.privateposts.service.HidePasswordService;

/**
 * 后台密码散列端点：服务端生成与校验端一致的 PBKDF2 配置，前端再把配置写入
 * Halo 当前文章设置表单，由 Halo 的保存动作统一持久化文章及其注解。
 */
@Configuration(proxyBeanMethods = false)
public class HidePasswordConsoleRouter implements CustomEndpoint {
    private static final GroupVersion API_VERSION =
        new GroupVersion("console.api.privateposts.halo.run", "v1alpha1");

    private final HidePasswordService hidePasswordService;

    public HidePasswordConsoleRouter(HidePasswordService hidePasswordService) {
        this.hidePasswordService = hidePasswordService;
    }

    @Override
    @Bean
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .POST("/hide-password/hash", this::hashPassword)
            .build();
    }

    @Override
    public GroupVersion groupVersion() {
        return API_VERSION;
    }

    private Mono<ServerResponse> hashPassword(ServerRequest request) {
        return requireConsoleAdmin()
            .then(request.bodyToMono(HashPasswordRequest.class))
            .switchIfEmpty(Mono.error(new IllegalArgumentException("请求内容不能为空")))
            .flatMap(body -> {
                if (!StringUtils.hasText(body.password())) {
                    return ServerResponse.badRequest()
                        .contentType(MediaType.APPLICATION_JSON)
                        .bodyValue(Map.of("message", "访问密码不能为空"));
                }

                String config = hidePasswordService.buildPasswordConfig(body.password());
                return ServerResponse.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(Map.of(
                        "config", config,
                        "message", "密码散列已生成"
                    ));
            })
            .onErrorResume(AccessDeniedException.class, this::forbiddenResponse)
            .onErrorResume(IllegalArgumentException.class, error -> ServerResponse.badRequest()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("message", error.getMessage())));
    }

    private Mono<Void> requireConsoleAdmin() {
        return ReactiveSecurityContextHolder.getContext()
            .map(context -> context.getAuthentication())
            .filter(Authentication::isAuthenticated)
            .switchIfEmpty(Mono.error(new AccessDeniedException("当前用户没有内容隐藏设置权限")))
            .then();
    }

    private Mono<ServerResponse> forbiddenResponse(AccessDeniedException error) {
        return ServerResponse.status(403)
            .contentType(MediaType.APPLICATION_JSON)
            .bodyValue(Map.of("message", error.getMessage()));
    }

    private record HashPasswordRequest(String password) {
    }
}
