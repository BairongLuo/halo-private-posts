package run.halo.privateposts.finder;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.privateposts.view.PrivatePostView;

public interface HaloPrivatePostFinder {
    Mono<PrivatePostView> getBySlug(String slug);

    Mono<PrivatePostView> getByPostName(String postName);

    Flux<PrivatePostView> listAll();
}
