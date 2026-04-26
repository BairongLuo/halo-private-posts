package run.halo.privateposts.service;

import java.util.Map;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
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
import run.halo.app.extension.index.query.QueryFactory;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

@Service
public class PrivatePostService {
    private static final Sort DEFAULT_SORT = Sort.by(Sort.Order.asc("spec.slug"));
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
            .flatMap(this::deleteDirectly)
            .then();
    }

    public Mono<Integer> cleanupStaleMappings() {
        return listAll()
            .flatMap(this::deleteIfStale)
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

    public Mono<Integer> deleteAllMappings() {
        return listAll()
            .flatMap(this::deleteDirectly)
            .count()
            .map(Math::toIntExact);
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

    private static boolean isActivePrivatePostSource(Post post) {
        if (post == null || post.isDeleted() || Post.isRecycled(post.getMetadata())) {
            return false;
        }

        MetadataOperator metadata = post.getMetadata();
        Map<String, String> annotations = metadata == null ? null : metadata.getAnnotations();
        if (annotations == null) {
            return false;
        }

        String bundleText = annotations.get(PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION);
        return StringUtils.hasText(bundleText);
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
        return Mono.defer(() -> client.delete(privatePost).then())
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

    boolean shouldFallbackToStoreDelete(Throwable error) {
        return error != null
            && "run.halo.app.extension.exception.SchemaViolationException"
            .equals(error.getClass().getName());
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

        Field field = findField(client.getClass(), "storeClient");
        if (field == null) {
            throw new NoSuchFieldException("storeClient");
        }

        field.setAccessible(true);
        Object storeClient = field.get(client);
        if (storeClient == null) {
            throw new IllegalStateException("ReactiveExtensionClient.storeClient is null");
        }

        reflectedStoreClient = storeClient;
        return storeClient;
    }

    private static Field findField(Class<?> type, String fieldName) {
        Class<?> current = type;
        while (current != null) {
            try {
                return current.getDeclaredField(fieldName);
            } catch (NoSuchFieldException ignored) {
                current = current.getSuperclass();
            }
        }
        return null;
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

    private static boolean isRetryableWriteFailure(Throwable error) {
        return error instanceof OptimisticLockingFailureException
            || error instanceof DuplicateKeyException;
    }
}
