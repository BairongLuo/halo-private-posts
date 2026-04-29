package run.halo.privateposts.theme;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.Metadata;
import run.halo.app.theme.ReactivePostContentHandler;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

class InlinePrivatePostContentHandlerTest {
    @Test
    void handleShouldKeepOriginalContentWhenBundleAnnotationIsMissing() {
        InlinePrivatePostContentHandler handler = new InlinePrivatePostContentHandler();
        ReactivePostContentHandler.PostContentContext context = contextFor(
            post("hello-halo", Map.of()),
            "<p>original content</p>"
        );

        ReactivePostContentHandler.PostContentContext result = handler.handle(context).block();

        assertThat(result).isSameAs(context);
        assertThat(result.getContent()).isEqualTo("<p>original content</p>");
    }

    @Test
    void handleShouldReplaceContentDirectlyFromSourceAnnotation() {
        InlinePrivatePostContentHandler handler = new InlinePrivatePostContentHandler();
        ReactivePostContentHandler.PostContentContext context = contextFor(
            post("hello-halo", Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
                bundleJson("hello-halo-slug", "Hello Halo", "公开摘要")
            )),
            "<p>original content</p>"
        );

        ReactivePostContentHandler.PostContentContext result = handler.handle(context).block();

        assertThat(result.getContent()).contains("data-halo-private-post-reader=\"true\"");
        assertThat(result.getContent()).contains("/private-posts/data?slug=hello-halo-slug");
        assertThat(result.getContent()).contains("公开摘要");
        assertThat(result.getContent()).contains("data-hpp-status data-status=\"neutral\" hidden");
        assertThat(result.getContent()).doesNotContain("这篇文章的正文已加密托管。输入访问密码后，正文会在浏览器本地解密。");
        assertThat(result.getContent()).doesNotContain("独立阅读页");
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

    private static String bundleJson(String slug, String title, String excerpt) {
        return """
            {"version":3,"payload_format":"markdown","cipher":"aes-256-gcm","kdf":"envelope",
            "data_iv":"00112233445566778899aabb",
            "ciphertext":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            "auth_tag":"00112233445566778899aabbccddeeff",
            "password_slot":{"kdf":"scrypt","salt":"00112233445566778899aabbccddeeff",
            "wrap_iv":"00112233445566778899aabb","wrapped_cek":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            "auth_tag":"00112233445566778899aabbccddeeff"},
            "site_recovery_slot":{"kid":"site-recovery-rsa-oaep-sha256-v1","alg":"RSA-OAEP-256",
            "wrapped_cek":"%s"},
            "metadata":{"slug":"%s","title":"%s","excerpt":"%s"}}
            """.formatted(repeatHex("11", 384), slug, title, excerpt).trim();
    }

    private static String repeatHex(String byteHex, int byteCount) {
        return byteHex.repeat(byteCount);
    }
}
