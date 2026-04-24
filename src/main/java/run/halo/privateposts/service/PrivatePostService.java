package run.halo.privateposts.service;

import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.index.query.QueryFactory;
import run.halo.privateposts.model.PrivatePost;

@Service
public class PrivatePostService {
    private static final Sort DEFAULT_SORT = Sort.by(Sort.Order.asc("spec.slug"));

    private final ReactiveExtensionClient client;

    public PrivatePostService(ReactiveExtensionClient client) {
        this.client = client;
    }

    public Flux<PrivatePost> listAll() {
        return client.listAll(PrivatePost.class, ListOptions.builder().build(), DEFAULT_SORT);
    }

    public Mono<PrivatePost> getBySlug(String slug) {
        return client.listAll(
                PrivatePost.class,
                ListOptions.builder()
                    .fieldQuery(QueryFactory.equal("spec.slug", slug))
                    .build(),
                DEFAULT_SORT
            )
            .next();
    }

    public Mono<PrivatePost> getByPostName(String postName) {
        return client.listAll(
                PrivatePost.class,
                ListOptions.builder()
                    .fieldQuery(QueryFactory.equal("spec.postName", postName))
                    .build(),
                DEFAULT_SORT
            )
            .next();
    }
}
