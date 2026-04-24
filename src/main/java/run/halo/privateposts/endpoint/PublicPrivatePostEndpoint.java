package run.halo.privateposts.endpoint;

import static org.springframework.http.MediaType.APPLICATION_JSON;

import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.server.RequestPredicates;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.extension.GroupVersion;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.view.PrivatePostView;

@Component
public class PublicPrivatePostEndpoint implements CustomEndpoint {
    private final PrivatePostService privatePostService;

    public PublicPrivatePostEndpoint(PrivatePostService privatePostService) {
        this.privatePostService = privatePostService;
    }

    @Override
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .GET("/private-posts", RequestPredicates.accept(APPLICATION_JSON), this::query)
            .build();
    }

    @Override
    public GroupVersion groupVersion() {
        return new GroupVersion("api.privateposts.halo.run", "v1alpha1");
    }

    private Mono<ServerResponse> query(ServerRequest request) {
        return request.queryParam("slug")
            .map(slug -> getBySlug(slug))
            .orElseGet(this::listAll);
    }

    private Mono<ServerResponse> listAll() {
        return privatePostService.listAll()
            .map(PrivatePostView::from)
            .collectList()
            .flatMap(items -> ServerResponse.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(List.copyOf(items)));
    }

    private Mono<ServerResponse> getBySlug(String slug) {
        return privatePostService.getBySlug(slug)
            .map(PrivatePostView::from)
            .flatMap(item -> ServerResponse.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(item))
            .switchIfEmpty(ServerResponse.notFound().build());
    }
}
