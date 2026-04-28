package run.halo.privateposts.finder;

import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.theme.finders.Finder;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.view.PrivatePostView;

@Component
@Finder("haloPrivatePostFinder")
public class HaloPrivatePostFinderImpl implements HaloPrivatePostFinder {
    private final PrivatePostService privatePostService;

    public HaloPrivatePostFinderImpl(PrivatePostService privatePostService) {
        this.privatePostService = privatePostService;
    }

    @Override
    public Mono<PrivatePostView> getBySlug(String slug) {
        return privatePostService.getPublicViewBySlug(slug);
    }

    @Override
    public Mono<PrivatePostView> getByPostName(String postName) {
        return privatePostService.getPublicViewByPostName(postName);
    }

    @Override
    public Flux<PrivatePostView> listAll() {
        return privatePostService.listPubliclyAccessible().map(PrivatePostView::from);
    }
}
