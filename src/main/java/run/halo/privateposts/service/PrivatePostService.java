package run.halo.privateposts.service;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.MetadataOperator;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.index.query.Queries;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.model.PrivatePostBundleValidator;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;
import run.halo.privateposts.view.PrivatePostView;

@Service
public class PrivatePostService {
    private static final Sort DEFAULT_SORT = Sort.by(Sort.Order.asc("spec.slug"));
    private static final Sort SOURCE_POST_SORT = Sort.by(Sort.Order.asc("metadata.name"));
    private static final int UPSERT_RETRIES = 2;
    private static final String PRIVATE_POST_STORE_PREFIX = "/registry/privateposts.halo.run/privateposts/";
    private static final Logger log = LoggerFactory.getLogger(PrivatePostService.class);

    private final ReactiveExtensionClient client;
    private volatile Object reflectedStoreClient;

    public PrivatePostService(ReactiveExtensionClient client) {
        this.client = client;
    }

    public Flux<PrivatePost> listAll() {
        return client.listAll(PrivatePost.class, ListOptions.builder().build(), DEFAULT_SORT);
    }

    public Flux<PrivatePost> listPubliclyAccessible() {
        return listAll().filterWhen(this::isPubliclyAccessible);
    }

    public Mono<PrivatePost> getBySlug(String slug) {
        return queryByField("spec.slug", slug)
            .switchIfEmpty(Mono.defer(() -> listAll()
                .filter(privatePost -> privatePost.getSpec() != null
                    && slug.equals(privatePost.getSpec().getSlug()))
                .next()));
    }

    public Mono<PrivatePost> getPubliclyAccessibleBySlug(String slug) {
        return getBySlug(slug).filterWhen(this::isPubliclyAccessible);
    }

    public Mono<PrivatePost> getByPostName(String postName) {
        return queryByField("spec.postName", postName)
            .switchIfEmpty(Mono.defer(() -> listAll()
                .filter(privatePost -> privatePost.getSpec() != null
                    && postName.equals(privatePost.getSpec().getPostName()))
                .next()));
    }

    public Mono<PrivatePost> getPubliclyAccessibleByPostName(String postName) {
        return getByPostName(postName).filterWhen(this::isPubliclyAccessible);
    }

    public Mono<PrivatePostView> getPublicViewBySlug(String slug) {
        if (!StringUtils.hasText(slug)) {
            return Mono.empty();
        }

        return findPublicSourcePostBySlug(slug)
            .flatMap(this::toPublicView);
    }

    public Mono<PrivatePostView> getPublicViewByPostName(String postName) {
        if (!StringUtils.hasText(postName)) {
            return Mono.empty();
        }

        return client.fetch(Post.class, postName)
            .filter(PrivatePostService::isPubliclyAccessiblePrivatePostSource)
            .flatMap(this::toPublicView)
            .switchIfEmpty(Mono.defer(() -> getPubliclyAccessibleByPostName(postName).map(PrivatePostView::from)));
    }

    public Mono<PrivatePost> upsert(PrivatePost privatePost) {
        return upsert(privatePost, UPSERT_RETRIES);
    }

    private Mono<PrivatePost> upsert(PrivatePost privatePost, int retriesLeft) {
        String postName = privatePost.getSpec().getPostName();
        return Mono.defer(() -> fetchCanonicalMapping(postName)
            .flatMap(existing -> {
                if (isDeletedMapping(existing)) {
                    return purgeDeletedTombstone(existing).then(Mono.empty());
                }

                privatePost.setMetadata(copyMetadata(existing.getMetadata()));
                return client.update(privatePost);
            })
            .switchIfEmpty(Mono.defer(() -> getByPostName(postName)
                .flatMap(existing -> {
                    privatePost.setMetadata(copyMetadata(existing.getMetadata()));
                    return client.update(privatePost);
                })
                .switchIfEmpty(Mono.defer(() -> {
                    privatePost.setMetadata(createMetadata(postName));
                    return client.create(privatePost);
                }))))
            .onErrorResume(PrivatePostService::isRetryableWriteFailure, error -> {
                if (retriesLeft <= 0) {
                    return Mono.error(error);
                }

                // Post save events can race with deletion/recreation/first-create of the same mapping.
                return purgeDeletedCanonicalMapping(postName)
                    .then(Mono.fromRunnable(() -> privatePost.setMetadata(null)))
                    .then(upsert(privatePost, retriesLeft - 1));
            }));
    }

    public Mono<Void> deleteByPostName(String postName) {
        return getByPostName(postName)
            .flatMap(privatePost -> deleteDirectly(privatePost).thenReturn(true))
            .defaultIfEmpty(false)
            .flatMap(deleted -> deleted ? Mono.empty() : purgeDeletedCanonicalMapping(postName));
    }

    public Mono<Integer> cleanupStaleMappings() {
        return listAll()
            .flatMap(this::deleteIfStale)
            .filter(Boolean::booleanValue)
            .count()
            .map(Math::toIntExact);
    }

    public Mono<Integer> reconcileMappings() {
        return client.listAll(Post.class, ListOptions.builder().build(), SOURCE_POST_SORT)
            .flatMap(this::upsertFromSourcePost)
            .filter(Boolean::booleanValue)
            .count()
            .map(Math::toIntExact);
    }

    private Mono<Boolean> deleteIfStale(PrivatePost privatePost) {
        return shouldRetainMapping(privatePost)
            .flatMap(shouldRetain -> {
                if (shouldRetain) {
                    return Mono.just(false);
                }

                return deleteDirectly(privatePost)
                    .thenReturn(true);
            });
    }

    private Mono<Boolean> upsertFromSourcePost(Post post) {
        if (post == null || post.getMetadata() == null || post.getSpec() == null || post.isDeleted()
            || Post.isRecycled(post.getMetadata())) {
            return Mono.just(false);
        }

        String postName = post.getMetadata().getName();
        if (!StringUtils.hasText(postName)) {
            return Mono.just(false);
        }

        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            postName,
            post.getMetadata().getAnnotations()
        );
        if (bundle == null) {
            return Mono.just(false);
        }

        PrivatePost privatePost = new PrivatePost();
        PrivatePost.PrivatePostSpec spec = new PrivatePost.PrivatePostSpec();
        spec.setPostName(postName);
        spec.setSlug(post.getSpec().getSlug());
        spec.setTitle(post.getSpec().getTitle());
        spec.setExcerpt(readExcerpt(post));
        spec.setPublishedAt(readPublishedAt(post.getSpec().getPublishTime()));
        spec.setBundle(bundle);
        privatePost.setSpec(spec);

        return upsert(privatePost)
            .thenReturn(true)
            .onErrorResume(error -> {
                log.warn("Failed to reconcile private post mapping for source post {} on startup.",
                    postName, error);
                return Mono.just(false);
            });
    }

    public Mono<Integer> deleteAllMappings() {
        return listAll()
            .flatMap(this::deleteDirectly)
            .count()
            .map(Math::toIntExact);
    }

    public Mono<DeleteAllMappingsResult> deleteAllMappingsBestEffort() {
        return listAll()
            .flatMap(privatePost -> deleteDirectly(privatePost)
                .thenReturn(DeleteOutcome.deleted(resourceName(privatePost)))
                .onErrorResume(error -> {
                    String resourceName = resourceName(privatePost);
                    log.warn("Failed to delete private post mapping {} during uninstall cleanup.",
                        resourceName, error);
                    return Mono.just(DeleteOutcome.failed(resourceName));
                }))
            .collectList()
            .map(outcomes -> {
                int deletedCount = 0;
                List<String> failedResourceNames = new ArrayList<>();
                for (DeleteOutcome outcome : outcomes) {
                    if (outcome.deleted()) {
                        deletedCount++;
                        continue;
                    }
                    failedResourceNames.add(outcome.resourceName());
                }
                return new DeleteAllMappingsResult(deletedCount, List.copyOf(failedResourceNames));
            })
            .onErrorResume(error -> {
                log.warn("Failed to list private post mappings during uninstall cleanup.", error);
                return Mono.just(new DeleteAllMappingsResult(0, List.of("<list-private-posts>")));
            });
    }

    private Mono<Boolean> shouldRetainMapping(PrivatePost privatePost) {
        if (privatePost.getSpec() == null
            || !StringUtils.hasText(privatePost.getSpec().getPostName())) {
            return Mono.just(false);
        }

        String postName = privatePost.getSpec().getPostName();
        return client.fetch(Post.class, postName)
            .map(PrivatePostService::isActivePrivatePostSource)
            .defaultIfEmpty(false)
            .onErrorResume(error -> {
                log.warn("Failed to validate private post mapping {} for source post {}.",
                    privatePost.getMetadata() == null ? "<unknown>" : privatePost.getMetadata().getName(),
                    postName,
                    error);
                return Mono.just(true);
            });
    }

    private Mono<Boolean> isPubliclyAccessible(PrivatePost privatePost) {
        if (privatePost == null || privatePost.getSpec() == null
            || !StringUtils.hasText(privatePost.getSpec().getPostName())) {
            return Mono.just(false);
        }

        String postName = privatePost.getSpec().getPostName();
        return client.fetch(Post.class, postName)
            .map(PrivatePostService::isPubliclyAccessiblePrivatePostSource)
            .defaultIfEmpty(false)
            .onErrorResume(error -> {
                log.warn("Failed to validate public accessibility for private post source {}.", postName,
                    error);
                return Mono.just(false);
            });
    }

    public static boolean isActivePrivatePostSource(Post post) {
        if (post == null || post.isDeleted() || Post.isRecycled(post.getMetadata())) {
            return false;
        }

        MetadataOperator metadata = post.getMetadata();
        Map<String, String> annotations = metadata == null ? null : metadata.getAnnotations();
        if (annotations == null) {
            return false;
        }

        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            metadata.getName(),
            annotations
        );
        return bundle != null && PrivatePostBundleValidator.isValid(bundle);
    }

    static boolean isPubliclyAccessiblePrivatePostSource(Post post) {
        return isActivePrivatePostSource(post)
            && post.isPublished()
            && post.getSpec() != null
            && Post.isPublic(post.getSpec());
    }

    private Mono<Post> findPublicSourcePostBySlug(String slug) {
        return client.listAll(
                Post.class,
                ListOptions.builder()
                    .fieldQuery(Queries.equal("spec.slug", slug))
                    .build(),
                SOURCE_POST_SORT
            )
            .filter(PrivatePostService::isPubliclyAccessiblePrivatePostSource)
            .next()
            .switchIfEmpty(Mono.defer(() -> client.listAll(
                    Post.class,
                    ListOptions.builder().build(),
                    SOURCE_POST_SORT
                )
                .filter(post -> post.getSpec() != null && slug.equals(post.getSpec().getSlug()))
                .filter(PrivatePostService::isPubliclyAccessiblePrivatePostSource)
                .next()))
            .switchIfEmpty(Mono.defer(() -> getPubliclyAccessibleBySlug(slug)
                .flatMap(privatePost -> client.fetch(Post.class, privatePost.getSpec().getPostName()))
                .filter(PrivatePostService::isPubliclyAccessiblePrivatePostSource)));
    }

    private Mono<PrivatePostView> toPublicView(Post post) {
        if (post == null || post.getMetadata() == null) {
            return Mono.empty();
        }

        String postName = post.getMetadata().getName();
        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            postName,
            post.getMetadata().getAnnotations()
        );
        if (bundle == null) {
            return Mono.empty();
        }

        return Mono.just(PrivatePostView.fromSourcePost(post, bundle));
    }

    private Mono<Void> deleteDirectly(PrivatePost privatePost) {
        if (privatePost == null || privatePost.getMetadata() == null) {
            return Mono.empty();
        }

        String resourceName = privatePost.getMetadata().getName();
        if (!StringUtils.hasText(resourceName)) {
            return Mono.empty();
        }

        Long version = privatePost.getMetadata().getVersion();
        return Mono.defer(() -> client.delete(privatePost)
                .flatMap(this::purgeDeletedTombstone)
                .then())
            .onErrorResume(error -> {
                if (!shouldFallbackToStoreDelete(error)) {
                    return Mono.error(error);
                }

                return deleteViaStoreFallback(resourceName, version);
            });
    }

    private static String storeName(String resourceName) {
        return PRIVATE_POST_STORE_PREFIX + resourceName;
    }

    private Mono<PrivatePost> fetchCanonicalMapping(String postName) {
        if (!StringUtils.hasText(postName)) {
            return Mono.empty();
        }

        Mono<PrivatePost> result = client.fetch(PrivatePost.class, postName);
        return result == null ? Mono.empty() : result;
    }

    private Mono<PrivatePost> queryByField(String fieldName, String value) {
        return client.listAll(
                PrivatePost.class,
                ListOptions.builder()
                    .fieldQuery(Queries.equal(fieldName, value))
                    .build(),
                DEFAULT_SORT
            )
            .next();
    }

    boolean shouldFallbackToStoreDelete(Throwable error) {
        return error != null
            && "run.halo.app.extension.exception.SchemaViolationException"
            .equals(error.getClass().getName());
    }

    private Mono<Void> purgeDeletedCanonicalMapping(String postName) {
        return fetchCanonicalMapping(postName)
            .flatMap(this::purgeDeletedTombstone)
            .then();
    }

    private Mono<Void> purgeDeletedTombstone(PrivatePost privatePost) {
        if (!isDeletedMapping(privatePost)) {
            return Mono.empty();
        }

        return deleteViaStoreFallback(
            resourceName(privatePost),
            privatePost.getMetadata().getVersion()
        );
    }

    Mono<Void> deleteViaStoreFallback(String resourceName, Long version) {
        return Mono.defer(() -> {
            if (!StringUtils.hasText(resourceName) || version == null) {
                return Mono.error(new IllegalStateException(
                    "Cannot fallback-delete private post mapping without name and version."
                ));
            }

            try {
                Object storeClient = resolveStoreClient();
                Method deleteMethod = findDeleteMethod(storeClient.getClass());
                Object result = deleteMethod.invoke(storeClient, storeName(resourceName), version);
                if (result instanceof Mono<?> mono) {
                    return mono.then();
                }
            } catch (ReflectiveOperationException error) {
                return Mono.error(error);
            }

            return Mono.error(new IllegalStateException(
                "Unexpected return type from ReactiveExtensionStoreClient.delete"
            ));
        }).doOnSuccess(ignored -> log.info(
            "Deleted legacy private post mapping {} via extension store fallback.",
            resourceName
        )).onErrorResume(error -> {
            log.warn("Failed to delete legacy private post mapping {} via extension store fallback.",
                resourceName, error);
            return Mono.error(error);
        });
    }

    private Object resolveStoreClient() throws ReflectiveOperationException {
        Object cached = reflectedStoreClient;
        if (cached != null) {
            return cached;
        }

        Object storeClient = findStoreDeleteTarget(client);
        if (storeClient == null) {
            throw new NoSuchFieldException("ReactiveExtensionStoreClient");
        }

        reflectedStoreClient = storeClient;
        return storeClient;
    }

    private static Object findStoreDeleteTarget(Object source) throws ReflectiveOperationException {
        if (source == null) {
            return null;
        }

        if (hasDeleteMethod(source.getClass())) {
            return source;
        }

        Class<?> current = source.getClass();
        while (current != null) {
            for (Field field : current.getDeclaredFields()) {
                field.setAccessible(true);
                Object candidate = field.get(source);
                if (candidate != null && hasDeleteMethod(candidate.getClass())) {
                    return candidate;
                }
            }
            current = current.getSuperclass();
        }

        return null;
    }

    private static boolean hasDeleteMethod(Class<?> type) {
        try {
            findDeleteMethod(type);
            return true;
        } catch (NoSuchMethodException ignored) {
            return false;
        }
    }

    private static Method findDeleteMethod(Class<?> type) throws NoSuchMethodException {
        for (Method method : type.getMethods()) {
            if (!method.getName().equals("delete") || method.getParameterCount() != 2) {
                continue;
            }

            Class<?>[] parameterTypes = method.getParameterTypes();
            if (parameterTypes[0] == String.class
                && (parameterTypes[1] == Long.class || parameterTypes[1] == long.class)) {
                return method;
            }
        }

        throw new NoSuchMethodException(type.getName() + "#delete(String, Long)");
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

    private static boolean isDeletedMapping(PrivatePost privatePost) {
        return privatePost != null
            && privatePost.getMetadata() != null
            && privatePost.getMetadata().getDeletionTimestamp() != null;
    }

    private static boolean isRetryableWriteFailure(Throwable error) {
        return error instanceof OptimisticLockingFailureException
            || error instanceof DuplicateKeyException;
    }

    private static String resourceName(PrivatePost privatePost) {
        if (privatePost == null || privatePost.getMetadata() == null
            || !StringUtils.hasText(privatePost.getMetadata().getName())) {
            return "<unknown>";
        }
        return privatePost.getMetadata().getName();
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

    private record DeleteOutcome(boolean deleted, String resourceName) {
        private static DeleteOutcome deleted(String resourceName) {
            return new DeleteOutcome(true, resourceName);
        }

        private static DeleteOutcome failed(String resourceName) {
            return new DeleteOutcome(false, resourceName);
        }
    }

    public record DeleteAllMappingsResult(int deletedCount, List<String> failedResourceNames) {
    }
}
