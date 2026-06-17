package run.halo.privateposts.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import run.halo.privateposts.model.PrivatePost;

class PrivatePostBundleCryptoServiceTest {
    private final PrivatePostBundleCryptoService service = new PrivatePostBundleCryptoService();

    @Test
    void reencryptWithContentKeyShouldKeepDescriptionInMetadata() {
        PrivatePost.BundleMetadata metadata = new PrivatePost.BundleMetadata();
        metadata.setSlug("demo-post");
        metadata.setTitle("Demo Post");
        metadata.setExcerpt("公开摘要");
        metadata.setPublishedAt("2026-06-17T00:00:00Z");
        metadata.setDescription("新的锁定说明");

        PrivatePost.Bundle result = service.reencryptWithContentKey(
            sourceBundle(),
            sampleContentKey(),
            "markdown",
            "# updated body",
            metadata
        );

        assertThat(result.getMetadata().getDescription()).isEqualTo("新的锁定说明");
        assertThat(result.getMetadata().getSlug()).isEqualTo("demo-post");
        assertThat(result.getMetadata().getTitle()).isEqualTo("Demo Post");
        assertThat(result.getMetadata().getExcerpt()).isEqualTo("公开摘要");
        assertThat(result.getMetadata().getPublishedAt()).isEqualTo("2026-06-17T00:00:00Z");
    }

    private static PrivatePost.Bundle sourceBundle() {
        PrivatePost.Bundle bundle = new PrivatePost.Bundle();
        bundle.setVersion(3);
        bundle.setPayloadFormat("markdown");
        bundle.setCipher("aes-256-gcm");
        bundle.setKdf("envelope");
        bundle.setDataIv("00112233445566778899aabb");
        bundle.setCiphertext("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
        bundle.setAuthTag("00112233445566778899aabbccddeeff");
        bundle.setPasswordSlot(passwordSlot());
        bundle.setSiteRecoverySlot(siteRecoverySlot());
        PrivatePost.BundleMetadata metadata = new PrivatePost.BundleMetadata();
        metadata.setSlug("demo-post");
        metadata.setTitle("Demo Post");
        bundle.setMetadata(metadata);
        return bundle;
    }

    private static PrivatePost.PasswordSlot passwordSlot() {
        PrivatePost.PasswordSlot slot = new PrivatePost.PasswordSlot();
        slot.setKdf("scrypt");
        slot.setSalt("00112233445566778899aabbccddeeff");
        slot.setWrapIv("00112233445566778899aabb");
        slot.setWrappedCek("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
        slot.setAuthTag("00112233445566778899aabbccddeeff");
        return slot;
    }

    private static PrivatePost.SiteRecoverySlot siteRecoverySlot() {
        PrivatePost.SiteRecoverySlot slot = new PrivatePost.SiteRecoverySlot();
        slot.setKid("site-recovery-rsa-oaep-sha256-v1");
        slot.setAlg("RSA-OAEP-256");
        slot.setWrappedCek("11".repeat(384));
        return slot;
    }

    private static byte[] sampleContentKey() {
        return new byte[] {
            1, 2, 3, 4, 5, 6, 7, 8,
            9, 10, 11, 12, 13, 14, 15, 16,
            17, 18, 19, 20, 21, 22, 23, 24,
            25, 26, 27, 28, 29, 30, 31, 32
        };
    }
}
