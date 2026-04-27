package run.halo.privateposts.theme;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.Metadata;
import run.halo.app.theme.ReactivePostContentHandler;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

class InlinePrivatePostContentHandlerTest {
    @Test
    void handleShouldKeepOriginalContentWhenBundleAnnotationIsMissing() {
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        InlinePrivatePostContentHandler handler = new InlinePrivatePostContentHandler(privatePostService);
        ReactivePostContentHandler.PostContentContext context = contextFor(
            post("hello-halo", Map.of()),
            "<p>original content</p>"
        );

        ReactivePostContentHandler.PostContentContext result = handler.handle(context).block();

        assertThat(result).isSameAs(context);
        assertThat(result.getContent()).isEqualTo("<p>original content</p>");
        verify(privatePostService, never()).getByPostName("hello-halo");
    }

    @Test
    void handleShouldReplaceContentWhenPostStillHasPrivateBundle() {
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        InlinePrivatePostContentHandler handler = new InlinePrivatePostContentHandler(privatePostService);
        ReactivePostContentHandler.PostContentContext context = contextFor(
            post("hello-halo", Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
                "{\"version\":2}"
            )),
            "<p>original content</p>"
        );
        when(privatePostService.getByPostName("hello-halo"))
            .thenReturn(Mono.just(privatePost("hello-halo")));

        ReactivePostContentHandler.PostContentContext result = handler.handle(context).block();

        assertThat(result.getContent()).contains("data-halo-private-post-reader=\"true\"");
        assertThat(result.getContent()).contains("/private-posts/data?slug=hello-halo-slug");
        verify(privatePostService).getByPostName("hello-halo");
    }

    private static ReactivePostContentHandler.PostContentContext contextFor(Post post, String content) {
        return ReactivePostContentHandler.PostContentContext.builder()
            .post(post)
            .content(content)
            .raw(content)
            .rawType("html")
            .build();
    }

    private static Post post(String name, Map<String, String> annotations) {
        Post post = new Post();
        Metadata metadata = new Metadata();
        metadata.setName(name);
        metadata.setAnnotations(new LinkedHashMap<>(annotations));
        post.setMetadata(metadata);

        Post.PostSpec spec = new Post.PostSpec();
        spec.setTitle(name + " title");
        spec.setSlug(name + "-slug");
        spec.setDeleted(false);
        spec.setVisible(Post.VisibleEnum.PUBLIC);
        post.setSpec(spec);
        return post;
    }

    private static PrivatePost privatePost(String postName) {
        PrivatePost privatePost = new PrivatePost();
        Metadata metadata = new Metadata();
        metadata.setName(postName);
        privatePost.setMetadata(metadata);

        PrivatePost.PrivatePostSpec spec = new PrivatePost.PrivatePostSpec();
        spec.setPostName(postName);
        spec.setSlug(postName + "-slug");
        spec.setTitle(postName + " title");
        spec.setBundle(new PrivatePost.Bundle());
        privatePost.setSpec(spec);
        return privatePost;
    }
}
