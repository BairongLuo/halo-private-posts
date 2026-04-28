package run.halo.privateposts.sync;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.Map;
import org.junit.jupiter.api.Test;
import run.halo.privateposts.model.PrivatePost;

class PostPrivatePostSyncListenerTest {
    @Test
    void shouldReadV3BundleFromAnnotations() {
        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            "demo-post",
            Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
                v3BundleJson("annotation-slug", "Annotation Title")
            )
        );

        assertNotNull(bundle);
        assertEquals(3, bundle.getVersion());
        assertEquals("annotation-slug", bundle.getMetadata().getSlug());
        assertEquals("Annotation Title", bundle.getMetadata().getTitle());
        assertNotNull(bundle.getSiteRecoverySlot());
    }

    @Test
    void shouldReturnNullWhenAnnotationBundleContainsPlaceholderCipherData() {
        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            "demo-post",
            Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
                """
                    {"version":3,"payload_format":"markdown","cipher":"aes-256-gcm",
                    "kdf":"envelope","data_iv":"2233","ciphertext":"4455","auth_tag":"6677",
                    "password_slot":{"kdf":"scrypt","salt":"0011","wrap_iv":"8899","wrapped_cek":"aabb","auth_tag":"ccdd"},
                    "site_recovery_slot":{"kid":"site-recovery-rsa-oaep-sha256-v1","alg":"RSA-OAEP-256","wrapped_cek":"11223344"},
                    "metadata":{"slug":"demo-post","title":"Demo Post"}}
                    """.trim()
            )
        );

        assertNull(bundle);
    }

    @Test
    void shouldReturnNullWhenAnnotationBundleIsInvalid() {
        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            "demo-post",
            Map.of(
                PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
                "{\"version\":3,\"metadata\":{\"slug\":\"broken\"}}"
            )
        );

        assertNull(bundle);
    }

    @Test
    void shouldReturnNullWhenAnnotationBundleIsMissing() {
        assertNull(PostPrivatePostSyncListener.readBundleFromAnnotations("demo-post", Map.of()));
    }

    private static String v3BundleJson(String slug, String title) {
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
            "metadata":{"slug":"%s","title":"%s"}}
            """.formatted(repeatHex("11", 384), slug, title).trim();
    }

    private static String repeatHex(String byteHex, int byteCount) {
        return byteHex.repeat(byteCount);
    }

}
