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

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Sort;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;
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
        Post recycledPost = post("recycled-post", Map.of(), true, false);

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
            false
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
                             boolean deleted) {
        Post post = new Post();
        Metadata metadata = new Metadata();
        metadata.setName(name);
        metadata.setAnnotations(new LinkedHashMap<>(annotations));
        if (recycled) {
            metadata.setLabels(Map.of(Post.DELETED_LABEL, "true"));
        }
        post.setMetadata(metadata);

        Post.PostSpec spec = new Post.PostSpec();
        spec.setTitle(name + " title");
        spec.setSlug(name + "-slug");
        spec.setDeleted(deleted);
        post.setSpec(spec);

        assertThat(post.isDeleted()).isEqualTo(deleted);
        assertThat(Post.isRecycled(post.getMetadata())).isEqualTo(recycled);
        return post;
    }
}
