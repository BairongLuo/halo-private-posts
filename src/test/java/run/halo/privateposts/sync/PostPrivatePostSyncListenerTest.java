package run.halo.privateposts.sync;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Map;
import org.junit.jupiter.api.Test;
import run.halo.privateposts.model.PrivatePost;

class PostPrivatePostSyncListenerTest {
    @Test
    void shouldReadBundleFromAnnotations() {
        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            "demo-post",
            Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
                bundleJson("annotation-slug", "Annotation Title")
            )
        );

        assertNotNull(bundle);
        assertEquals("annotation-slug", bundle.getMetadata().getSlug());
        assertEquals("Annotation Title", bundle.getMetadata().getTitle());
    }

    @Test
    void shouldReturnNullWhenAnnotationBundleIsInvalid() {
        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            "demo-post",
            Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
                "{\"version\":2,\"metadata\":{\"slug\":\"broken\"}}"
            )
        );

        assertNull(bundle);
    }

    @Test
    void shouldReturnNullWhenAnnotationBundleIsMissing() {
        assertNull(PostPrivatePostSyncListener.readBundleFromAnnotations("demo-post", Map.of()));
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
}
