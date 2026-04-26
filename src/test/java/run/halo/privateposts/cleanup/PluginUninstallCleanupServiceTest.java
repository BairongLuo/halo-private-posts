package run.halo.privateposts.cleanup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Sort;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.ExtensionClient;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

class PluginUninstallCleanupServiceTest {
    @Test
    void cleanupShouldUnlockPostsAndDeletePluginResources() {
        ExtensionClient client = mock(ExtensionClient.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        PluginUninstallCleanupService service = new PluginUninstallCleanupService(client, privatePostService);
        Post encryptedPost = post("encrypted-post", Map.of(
            PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION, "{\"version\":1}",
            "keep", "value"
        ));
        Post plainPost = post("plain-post", Map.of("keep", "value"));

        when(client.listAll(eq(Post.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(java.util.List.of(encryptedPost, plainPost));
        when(privatePostService.deleteAllMappings())
            .thenReturn(reactor.core.publisher.Mono.just(1));

        PluginUninstallCleanupService.CleanupSummary summary = service.cleanup();

        assertThat(summary.unlockedPosts()).isEqualTo(1);
        assertThat(summary.deletedPrivatePosts()).isEqualTo(1);

        ArgumentCaptor<Post> updatedPostCaptor = ArgumentCaptor.forClass(Post.class);
        verify(client).update(updatedPostCaptor.capture());
        assertThat(updatedPostCaptor.getValue().getMetadata().getAnnotations())
            .containsEntry("keep", "value")
            .doesNotContainKey(PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION);
        verify(privatePostService).deleteAllMappings();
    }

    private static Post post(String name, Map<String, String> annotations) {
        Post post = new Post();
        Metadata metadata = new Metadata();
        metadata.setName(name);
        metadata.setAnnotations(new LinkedHashMap<>(annotations));
        post.setMetadata(metadata);
        return post;
    }
}
