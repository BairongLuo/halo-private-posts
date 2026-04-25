package run.halo.privateposts.service;

import org.springframework.data.domain.Sort;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.MetadataOperator;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.index.query.QueryFactory;
import run.halo.privateposts.model.PrivatePost;

@Service
public class PrivatePostService {
    private static final Sort DEFAULT_SORT = Sort.by(Sort.Order.asc("spec.slug"));
    private static final int UPSERT_RETRIES = 2;

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

    public Mono<PrivatePost> upsert(PrivatePost privatePost) {
        return upsert(privatePost, UPSERT_RETRIES);
    }

    private Mono<PrivatePost> upsert(PrivatePost privatePost, int retriesLeft) {
        String postName = privatePost.getSpec().getPostName();
        return Mono.defer(() -> getByPostName(postName)
            .flatMap(existing -> {
                privatePost.setMetadata(copyMetadata(existing.getMetadata()));
                return client.update(privatePost);
            })
            .switchIfEmpty(Mono.defer(() -> {
                privatePost.setMetadata(createMetadata(postName));
                return client.create(privatePost);
            }))
            .onErrorResume(PrivatePostService::isRetryableWriteFailure, error -> {
                if (retriesLeft <= 0) {
                    return Mono.error(error);
                }

                // Post save events can race with deletion/recreation/first-create of the same mapping.
                privatePost.setMetadata(null);
                return upsert(privatePost, retriesLeft - 1);
            }));
    }

    public Mono<Void> deleteByPostName(String postName) {
        return getByPostName(postName)
            .flatMap(client::delete)
            .then();
    }

    private static Metadata createMetadata(String postName) {
        Metadata metadata = new Metadata();
        metadata.setName(postName);
        return metadata;
    }

    private static Metadata copyMetadata(MetadataOperator metadata) {
        if (metadata == null) {
            return null;
        }

        Metadata copied = new Metadata();
        copied.setName(metadata.getName());
        copied.setGenerateName(metadata.getGenerateName());
        copied.setLabels(metadata.getLabels());
        copied.setAnnotations(metadata.getAnnotations());
        copied.setVersion(metadata.getVersion());
        copied.setCreationTimestamp(metadata.getCreationTimestamp());
        copied.setDeletionTimestamp(metadata.getDeletionTimestamp());
        copied.setFinalizers(metadata.getFinalizers());
        return copied;
    }

    private static boolean isRetryableWriteFailure(Throwable error) {
        return error instanceof OptimisticLockingFailureException
            || error instanceof DuplicateKeyException;
    }
}
