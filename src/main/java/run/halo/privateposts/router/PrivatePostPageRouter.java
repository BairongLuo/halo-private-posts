package run.halo.privateposts.router;

import java.util.HashMap;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import org.springframework.web.util.UriUtils;
import reactor.core.publisher.Mono;
import run.halo.app.theme.TemplateNameResolver;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.view.PrivatePostView;

@Configuration(proxyBeanMethods = false)
public class PrivatePostPageRouter {
    private final TemplateNameResolver templateNameResolver;
    private final PrivatePostService privatePostService;

    public PrivatePostPageRouter(TemplateNameResolver templateNameResolver,
                                 PrivatePostService privatePostService) {
        this.templateNameResolver = templateNameResolver;
        this.privatePostService = privatePostService;
    }

    @Bean
    RouterFunction<ServerResponse> privatePostRouterFunction() {
        return RouterFunctions.route()
            .GET("/private-posts", this::renderPrivatePostPage)
            .GET("/private-posts/data", this::queryPrivatePost)
            .build();
    }

    private Mono<ServerResponse> queryPrivatePost(ServerRequest request) {
        String slug = request.queryParam("slug").orElse("");
        if (slug.isBlank()) {
            return ServerResponse.notFound().build();
        }
        return privatePostService.getPublicViewBySlug(slug)
            .flatMap(view -> ServerResponse.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(view))
            .switchIfEmpty(ServerResponse.notFound().build());
    }

    private Mono<ServerResponse> renderPrivatePostPage(ServerRequest request) {
        String slug = request.queryParam("slug").orElse("");
        if (slug.isBlank()) {
            return ServerResponse.notFound().build();
        }
        return privatePostService.getPublicViewBySlug(slug)
            .flatMap(view -> renderTemplate(request, view))
            .switchIfEmpty(ServerResponse.notFound().build());
    }

    private Mono<ServerResponse> renderTemplate(ServerRequest request, PrivatePostView view) {
        Map<String, Object> model = new HashMap<>();
        model.put("title", view.title());
        model.put("excerpt", nullToEmpty(view.excerpt()));
        model.put("slug", view.slug());
        model.put("publishedAt", nullToEmpty(view.publishedAt()));
        model.put("idleTimeoutMs", 300000);
        model.put(
            "bundleApiPath",
            "/private-posts/data?slug="
                + UriUtils.encode(view.slug(), "UTF-8")
        );
        return templateNameResolver.resolveTemplateNameOrDefault(
                request.exchange(),
                "private-post"
            )
            .flatMap(templateName -> ServerResponse.ok()
                .cacheControl(CacheControl.noStore())
                .render(templateName, model));
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
