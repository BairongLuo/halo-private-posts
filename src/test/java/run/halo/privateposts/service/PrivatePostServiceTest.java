package run.halo.privateposts.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.concurrent.atomic.AtomicReference;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Sort;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.Extension;
import run.halo.app.extension.GroupVersionKind;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.ListResult;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.PageRequest;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Unstructured;
import run.halo.app.extension.Watcher;
import run.halo.app.extension.index.IndexedQueryEngine;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

class PrivatePostServiceTest {
    @Test
    void cleanupStaleMappingsShouldDeleteMissingSourcePosts() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = new PrivatePostService(client);
        PrivatePost mapping = privatePost("stale-post");

        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(mapping));
        when(client.fetch(Post.class, "stale-post"))
            .thenReturn(Mono.empty());
        when(client.delete(mapping))
            .thenReturn(Mono.just(mapping));

        Integer deletedCount = service.cleanupStaleMappings().block();

        assertThat(deletedCount).isEqualTo(1);
        verify(client).delete(mapping);
    }

    @Test
    void cleanupStaleMappingsShouldDeleteRecycledSourcePosts() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = new PrivatePostService(client);
        PrivatePost mapping = privatePost("recycled-post");
        Post recycledPost = post("recycled-post", Map.of(), true, false, false, Post.VisibleEnum.PUBLIC);

        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(mapping));
        when(client.fetch(Post.class, "recycled-post"))
            .thenReturn(Mono.just(recycledPost));
        when(client.delete(mapping))
            .thenReturn(Mono.just(mapping));

        Integer deletedCount = service.cleanupStaleMappings().block();

        assertThat(deletedCount).isEqualTo(1);
        verify(client).delete(mapping);
    }

    @Test
    void cleanupStaleMappingsShouldKeepActiveSourcePosts() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = new PrivatePostService(client);
        PrivatePost mapping = privatePost("active-post");
        Post activePost = post(
            "active-post",
            Map.of(PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION, "{\"version\":2}"),
            false,
            false,
            false,
            Post.VisibleEnum.PUBLIC
        );

        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(mapping));
        when(client.fetch(Post.class, "active-post"))
            .thenReturn(Mono.just(activePost));

        Integer deletedCount = service.cleanupStaleMappings().block();

        assertThat(deletedCount).isZero();
        verify(client, never()).delete(any());
    }

    @Test
    void deleteByPostNameShouldFallbackWhenSchemaValidationBlocksDelete() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = spy(new PrivatePostService(client));
        PrivatePost mapping = privatePost("invalid-post");

        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(mapping));
        when(client.delete(mapping))
            .thenReturn(Mono.error(new RuntimeException("schema blocked delete")));
        doReturn(true).when(service).shouldFallbackToStoreDelete(any());
        doReturn(Mono.empty()).when(service).deleteViaStoreFallback("invalid-post", 7L);

        service.deleteByPostName("invalid-post").block();

        verify(service).deleteViaStoreFallback("invalid-post", 7L);
    }

    @Test
    void listPubliclyAccessibleShouldExcludeUnpublishedAndPrivateSources() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = new PrivatePostService(client);
        PrivatePost publicMapping = privatePost("public-post");
        PrivatePost unpublishedMapping = privatePost("draft-post");
        PrivatePost privateVisibilityMapping = privatePost("internal-post");

        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(publicMapping, unpublishedMapping, privateVisibilityMapping));
        when(client.fetch(Post.class, "public-post"))
            .thenReturn(Mono.just(post("public-post", Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION, "{\"version\":2}"
            ), false, false, true, Post.VisibleEnum.PUBLIC)));
        when(client.fetch(Post.class, "draft-post"))
            .thenReturn(Mono.just(post("draft-post", Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION, "{\"version\":2}"
            ), false, false, false, Post.VisibleEnum.PUBLIC)));
        when(client.fetch(Post.class, "internal-post"))
            .thenReturn(Mono.just(post("internal-post", Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION, "{\"version\":2}"
            ), false, false, true, Post.VisibleEnum.INTERNAL)));

        List<String> accessiblePostNames = service.listPubliclyAccessible()
            .map(privatePost -> privatePost.getSpec().getPostName())
            .collectList()
            .block();

        assertThat(accessiblePostNames).containsExactly("public-post");
    }

    @Test
    void getPubliclyAccessibleBySlugShouldHideNonPublicSource() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = new PrivatePostService(client);
        PrivatePost mapping = privatePost("hidden-post");

        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(mapping));
        when(client.fetch(Post.class, "hidden-post"))
            .thenReturn(Mono.just(post("hidden-post", Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION, "{\"version\":2}"
            ), false, false, true, Post.VisibleEnum.PRIVATE)));

        PrivatePost result = service.getPubliclyAccessibleBySlug("hidden-post-slug").block();

        assertThat(result).isNull();
    }

    @Test
    void deleteAllMappingsBestEffortShouldContinueAfterFailures() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = new PrivatePostService(client);
        PrivatePost deletable = privatePost("deletable-post");
        PrivatePost broken = privatePost("broken-post");

        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(deletable, broken));
        when(client.delete(deletable))
            .thenReturn(Mono.just(deletable));
        when(client.delete(broken))
            .thenReturn(Mono.error(new RuntimeException("delete failed")));

        PrivatePostService.DeleteAllMappingsResult result = service.deleteAllMappingsBestEffort()
            .block();

        assertThat(result.deletedCount()).isEqualTo(1);
        assertThat(result.failedResourceNames()).containsExactly("broken-post");
    }

    @Test
    void getBySlugShouldFallbackToFullScanWhenFieldQueryMisses() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = new PrivatePostService(client);
        PrivatePost mapping = privatePost("slug-fallback-post");

        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.empty(), Flux.just(mapping));

        PrivatePost result = service.getBySlug("slug-fallback-post-slug").block();

        assertThat(result).isSameAs(mapping);
    }

    @Test
    void reconcileMappingsShouldCreateMappingsForAnnotatedPosts() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        PrivatePostService service = new PrivatePostService(client);
        Post sourcePost = post(
            "hello-private-post",
            Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
                bundleJson("hello-halo", "Hello Halo")
            ),
            false,
            false,
            true,
            Post.VisibleEnum.PUBLIC
        );
        AtomicReference<PrivatePost> created = new AtomicReference<>();

        when(client.listAll(eq(Post.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(sourcePost));
        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.empty(), Flux.empty());
        when(client.create(any(PrivatePost.class)))
            .thenAnswer(invocation -> {
                PrivatePost privatePost = invocation.getArgument(0);
                created.set(privatePost);
                return Mono.just(privatePost);
            });

        Integer reconciledCount = service.reconcileMappings().block();

        assertThat(reconciledCount).isEqualTo(1);
        assertThat(created.get()).isNotNull();
        assertThat(created.get().getSpec().getPostName()).isEqualTo("hello-private-post");
        assertThat(created.get().getSpec().getSlug()).isEqualTo("hello-private-post-slug");
        assertThat(created.get().getSpec().getBundle().getMetadata().getSlug()).isEqualTo("hello-halo");
    }

    @Test
    void deleteViaStoreFallbackShouldResolveNestedStoreClientOnHalo224() {
        FakeStoreClient storeClient = new FakeStoreClient();
        PrivatePostService service = new PrivatePostService(new ReactiveClientWithNestedStore(storeClient));

        service.deleteViaStoreFallback("legacy-post", 9L).block();

        assertThat(storeClient.deletedName)
            .isEqualTo("/registry/privateposts.halo.run/privateposts/legacy-post");
        assertThat(storeClient.deletedVersion).isEqualTo(9L);
    }

    private static PrivatePost privatePost(String postName) {
        PrivatePost privatePost = new PrivatePost();
        Metadata metadata = new Metadata();
        metadata.setName(postName);
        metadata.setVersion(7L);
        privatePost.setMetadata(metadata);

        PrivatePost.PrivatePostSpec spec = new PrivatePost.PrivatePostSpec();
        spec.setPostName(postName);
        spec.setSlug(postName + "-slug");
        spec.setTitle(postName + " title");
        spec.setBundle(new PrivatePost.Bundle());
        privatePost.setSpec(spec);

        return privatePost;
    }

    private static Post post(String name,
                             Map<String, String> annotations,
                             boolean recycled,
                             boolean deleted,
                             boolean published,
                             Post.VisibleEnum visible) {
        Post post = new Post();
        Metadata metadata = new Metadata();
        metadata.setName(name);
        metadata.setAnnotations(new LinkedHashMap<>(annotations));
        Map<String, String> labels = new LinkedHashMap<>();
        if (recycled) {
            labels.put(Post.DELETED_LABEL, "true");
        }
        if (published) {
            labels.put(Post.PUBLISHED_LABEL, "true");
        }
        metadata.setLabels(labels.isEmpty() ? null : labels);
        post.setMetadata(metadata);

        Post.PostSpec spec = new Post.PostSpec();
        spec.setTitle(name + " title");
        spec.setSlug(name + "-slug");
        spec.setDeleted(deleted);
        spec.setVisible(visible);
        post.setSpec(spec);

        assertThat(post.isDeleted()).isEqualTo(deleted);
        assertThat(post.isPublished()).isEqualTo(published);
        assertThat(Post.isRecycled(post.getMetadata())).isEqualTo(recycled);
        return post;
    }

    private static String bundleJson(String slug, String title) {
        return """
            {"version":2,"payload_format":"markdown","cipher":"aes-256-gcm",
            "kdf":"envelope","data_iv":"2233","ciphertext":"4455","auth_tag":"6677",
            "password_slot":{"kdf":"scrypt","salt":"0011","wrap_iv":"8899","wrapped_cek":"aabb","auth_tag":"ccdd"},
            "recovery_slot":{"scheme":"mnemonic-v1","wrap_alg":"aes-256-gcm","wrap_iv":"1122","wrapped_cek":"3344","auth_tag":"5566"},
            "metadata":{"slug":"%s","title":"%s"}}
            """.formatted(slug, title).trim();
    }

    private static final class FakeStoreClient {
        private String deletedName;
        private Long deletedVersion;

        public Mono<Void> delete(String name, Long version) {
            this.deletedName = name;
            this.deletedVersion = version;
            return Mono.empty();
        }
    }

    private static final class ReactiveClientWithNestedStore implements ReactiveExtensionClient {
        @SuppressWarnings("unused")
        private final FakeStoreClient client;

        private ReactiveClientWithNestedStore(FakeStoreClient client) {
            this.client = client;
        }

        @Override
        public <E extends Extension> Flux<E> list(Class<E> type,
                                                  Predicate<E> predicate,
                                                  Comparator<E> comparator) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<ListResult<E>> list(Class<E> type,
                                                              Predicate<E> predicate,
                                                              Comparator<E> comparator,
                                                              int page,
                                                              int size) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Flux<E> listAll(Class<E> type,
                                                     ListOptions options,
                                                     Sort sort) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Flux<String> listAllNames(Class<E> type,
                                                               ListOptions options,
                                                               Sort sort) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Flux<String> listTopNames(Class<E> type,
                                                               ListOptions options,
                                                               Sort sort,
                                                               int limit) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<ListResult<E>> listBy(Class<E> type,
                                                                ListOptions options,
                                                                PageRequest pageRequest) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<ListResult<String>> listNamesBy(Class<E> type,
                                                                          ListOptions options,
                                                                          PageRequest pageRequest) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<Long> countBy(Class<E> type, ListOptions options) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<E> fetch(Class<E> type, String name) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Mono<Unstructured> fetch(GroupVersionKind gvk, String name) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<E> get(Class<E> type, String name) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Mono<run.halo.app.extension.JsonExtension> getJsonExtension(GroupVersionKind gvk,
                                                                           String name) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<E> create(E extension) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<E> update(E extension) {
            throw new UnsupportedOperationException();
        }

        @Override
        public <E extends Extension> Mono<E> delete(E extension) {
            throw new UnsupportedOperationException();
        }

        @Override
        public IndexedQueryEngine indexedQueryEngine() {
            throw new UnsupportedOperationException();
        }

        @Override
        public void watch(Watcher watcher) {
            throw new UnsupportedOperationException();
        }
    }
}
