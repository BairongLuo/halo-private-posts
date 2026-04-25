package run.halo.privateposts.cleanup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Sort;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.ExtensionClient;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.privateposts.model.AuthorKey;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

class PluginUninstallCleanupServiceTest {
    @Test
    void cleanupShouldUnlockPostsAndDeletePluginResources() {
        ExtensionClient client = mock(ExtensionClient.class);
        PluginUninstallCleanupService service = new PluginUninstallCleanupService(client);
        Post encryptedPost = post("encrypted-post", Map.of(
            PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION, "{\"version\":1}",
            "keep", "value"
        ));
        Post plainPost = post("plain-post", Map.of("keep", "value"));
        PrivatePost privatePost = privatePost("encrypted-post");
        AuthorKey authorKey = authorKey("author-key-1");

        when(client.listAll(eq(Post.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(List.of(encryptedPost, plainPost));
        when(client.listAll(eq(PrivatePost.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(List.of(privatePost));
        when(client.listAll(eq(AuthorKey.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(List.of(authorKey));

        PluginUninstallCleanupService.CleanupSummary summary = service.cleanup();

        assertThat(summary.unlockedPosts()).isEqualTo(1);
        assertThat(summary.deletedPrivatePosts()).isEqualTo(1);
        assertThat(summary.deletedAuthorKeys()).isEqualTo(1);

        ArgumentCaptor<Post> updatedPostCaptor = ArgumentCaptor.forClass(Post.class);
        verify(client).update(updatedPostCaptor.capture());
        assertThat(updatedPostCaptor.getValue().getMetadata().getAnnotations())
            .containsEntry("keep", "value")
            .doesNotContainKey(PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION);
        verify(client).delete(privatePost);
        verify(client).delete(authorKey);
    }

    private static Post post(String name, Map<String, String> annotations) {
        Post post = new Post();
        Metadata metadata = new Metadata();
        metadata.setName(name);
        metadata.setAnnotations(new LinkedHashMap<>(annotations));
        post.setMetadata(metadata);
        return post;
    }

    private static PrivatePost privatePost(String name) {
        PrivatePost privatePost = new PrivatePost();
        Metadata metadata = new Metadata();
        metadata.setName(name);
        privatePost.setMetadata(metadata);
        return privatePost;
    }

    private static AuthorKey authorKey(String name) {
        AuthorKey authorKey = new AuthorKey();
        Metadata metadata = new Metadata();
        metadata.setName(name);
        authorKey.setMetadata(metadata);
        return authorKey;
    }
}
