package run.halo.privateposts.router;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;
import run.halo.app.content.ContentWrapper;
import run.halo.app.content.PostContentService;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.privateposts.service.HidePasswordService;

class HidePasswordRouterTest {
    private final ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
    private final PostContentService postContentService = mock(PostContentService.class);
    private final HidePasswordService hidePasswordService = new HidePasswordService();
    private WebTestClient webClient;

    @BeforeEach
    void setUp() {
        HidePasswordRouter router = new HidePasswordRouter(
            client,
            postContentService,
            hidePasswordService
        );
        assertEquals("api.privateposts.halo.run", router.groupVersion().group());
        assertEquals("v1alpha1", router.groupVersion().version());
        webClient = WebTestClient.bindToRouterFunction(router.endpoint()).build();
    }

    @Test
    void rejectsUnpublishedPostsEvenWhenThePasswordIsCorrect() {
        Post draft = post("demo-post", false, Post.VisibleEnum.PUBLIC, "secret");
        when(client.fetch(Post.class, "demo-post")).thenReturn(Mono.just(draft));

        webClient.post()
            .uri("/hide-password/verify")
            .bodyValue(Map.of("postName", "demo-post", "password", "secret"))
            .exchange()
            .expectStatus().isUnauthorized();

        verifyNoInteractions(postContentService);
    }

    @Test
    void rejectsNonPublicPostsEvenWhenThePasswordIsCorrect() {
        Post privatePost = post("demo-post", true, Post.VisibleEnum.PRIVATE, "secret");
        when(client.fetch(Post.class, "demo-post")).thenReturn(Mono.just(privatePost));

        webClient.post()
            .uri("/hide-password/verify")
            .bodyValue(Map.of("postName", "demo-post", "password", "secret"))
            .exchange()
            .expectStatus().isUnauthorized();

        verifyNoInteractions(postContentService);
    }

    @Test
    void returnsRenderedSegmentsForPublishedPublicPosts() {
        Post post = post("demo-post", true, Post.VisibleEnum.PUBLIC, "secret");
        when(client.fetch(Post.class, "demo-post")).thenReturn(Mono.just(post));
        when(postContentService.getReleaseContent("demo-post")).thenReturn(Mono.just(
            ContentWrapper.builder()
                .content("<p>[hide-password]</p><p>秘密</p><p>[/hide-password]</p>")
                .build()
        ));

        webClient.post()
            .uri("/hide-password/verify")
            .bodyValue(Map.of("postName", "demo-post", "password", "secret"))
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.segments[0]").isEqualTo("<p>秘密</p>");
    }

    @Test
    void rejectsAnEmptyRequestBody() {
        webClient.post()
            .uri("/hide-password/verify")
            .exchange()
            .expectStatus().isBadRequest()
            .expectBody()
            .jsonPath("$.message").isEqualTo("请求内容不能为空");
    }

    private Post post(String name, boolean published, Post.VisibleEnum visible, String password) {
        Post post = new Post();
        Metadata metadata = new Metadata();
        metadata.setName(name);
        if (published) {
            metadata.setLabels(new LinkedHashMap<>(Map.of(Post.PUBLISHED_LABEL, "true")));
        }
        metadata.setAnnotations(new LinkedHashMap<>(Map.of(
            HidePasswordService.HIDE_PASSWORD_ANNOTATION,
            hidePasswordService.buildPasswordConfig(password)
        )));
        post.setMetadata(metadata);

        Post.PostSpec spec = new Post.PostSpec();
        spec.setPublish(published);
        spec.setVisible(visible);
        post.setSpec(spec);
        return post;
    }
}
