package run.halo.privateposts.model;

import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;

public final class PrivatePostBundleValidator {
    public static final int BUNDLE_VERSION = 3;
    public static final String PAYLOAD_FORMAT_MARKDOWN = "markdown";
    public static final String PAYLOAD_FORMAT_HTML = "html";
    public static final String BUNDLE_CIPHER = "aes-256-gcm";
    public static final String BUNDLE_KDF = "envelope";
    public static final String PASSWORD_SLOT_KDF = "scrypt";
    public static final String SITE_RECOVERY_KID = "site-recovery-rsa-oaep-sha256-v1";
    public static final String SITE_RECOVERY_ALGORITHM = "RSA-OAEP-256";

    private static final int AES_GCM_IV_BYTES = 12;
    private static final int AES_GCM_AUTH_TAG_BYTES = 16;
    private static final int PASSWORD_SLOT_SALT_BYTES = 16;
    private static final int CONTENT_KEY_BYTES = 32;
    private static final int SITE_RECOVERY_WRAPPED_CEK_BYTES = 384;
    private static final int MIN_CONTENT_CIPHERTEXT_BYTES = 16;

    private PrivatePostBundleValidator() {
    }

    public static boolean isValid(@Nullable PrivatePost.Bundle bundle) {
        try {
            validate(bundle);
            return true;
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    public static void validate(@Nullable PrivatePost.Bundle bundle) {
        if (bundle == null) {
            throw new IllegalArgumentException("Bundle 缺失");
        }

        if (bundle.getVersion() == null || bundle.getVersion() != BUNDLE_VERSION) {
            throw new IllegalArgumentException("只支持 v3 私密正文 bundle");
        }

        String payloadFormat = requireText(bundle.getPayloadFormat(), "payload_format");
        if (!PAYLOAD_FORMAT_MARKDOWN.equals(payloadFormat) && !PAYLOAD_FORMAT_HTML.equals(payloadFormat)) {
            throw new IllegalArgumentException("当前 bundle 的 payload_format 不受支持");
        }

        if (!BUNDLE_CIPHER.equals(requireText(bundle.getCipher(), "cipher"))
            || !BUNDLE_KDF.equals(requireText(bundle.getKdf(), "kdf"))) {
            throw new IllegalArgumentException("当前 bundle 的算法组合不受支持");
        }

        requireHexExact(bundle.getDataIv(), AES_GCM_IV_BYTES, "data_iv");
        requireHexAtLeast(bundle.getCiphertext(), MIN_CONTENT_CIPHERTEXT_BYTES, "ciphertext");
        requireHexExact(bundle.getAuthTag(), AES_GCM_AUTH_TAG_BYTES, "auth_tag");
        validatePasswordSlot(bundle.getPasswordSlot());
        validateSiteRecoverySlot(bundle.getSiteRecoverySlot());
        validateMetadata(bundle.getMetadata());
    }

    private static void validatePasswordSlot(@Nullable PrivatePost.PasswordSlot passwordSlot) {
        if (passwordSlot == null) {
            throw new IllegalArgumentException("password_slot 缺失");
        }

        if (!PASSWORD_SLOT_KDF.equals(requireText(passwordSlot.getKdf(), "password_slot.kdf"))) {
            throw new IllegalArgumentException("当前 bundle 的 password slot 算法不受支持");
        }

        requireHexExact(passwordSlot.getSalt(), PASSWORD_SLOT_SALT_BYTES, "password_slot.salt");
        requireHexExact(passwordSlot.getWrapIv(), AES_GCM_IV_BYTES, "password_slot.wrap_iv");
        requireHexExact(passwordSlot.getWrappedCek(), CONTENT_KEY_BYTES, "password_slot.wrapped_cek");
        requireHexExact(passwordSlot.getAuthTag(), AES_GCM_AUTH_TAG_BYTES, "password_slot.auth_tag");
    }

    private static void validateSiteRecoverySlot(@Nullable PrivatePost.SiteRecoverySlot siteRecoverySlot) {
        if (siteRecoverySlot == null) {
            throw new IllegalArgumentException("site_recovery_slot 缺失");
        }

        if (!SITE_RECOVERY_KID.equals(requireText(siteRecoverySlot.getKid(), "site_recovery_slot.kid"))) {
            throw new IllegalArgumentException("当前 bundle 的平台恢复 kid 不受支持");
        }

        if (!SITE_RECOVERY_ALGORITHM.equals(requireText(siteRecoverySlot.getAlg(), "site_recovery_slot.alg"))) {
            throw new IllegalArgumentException("当前 bundle 的平台恢复算法不受支持");
        }

        requireHexExact(
            siteRecoverySlot.getWrappedCek(),
            SITE_RECOVERY_WRAPPED_CEK_BYTES,
            "site_recovery_slot.wrapped_cek"
        );
    }

    private static void validateMetadata(@Nullable PrivatePost.BundleMetadata metadata) {
        if (metadata == null) {
            throw new IllegalArgumentException("metadata 缺失");
        }

        requireText(metadata.getSlug(), "metadata.slug");
        requireText(metadata.getTitle(), "metadata.title");
    }

    private static void requireHexExact(@Nullable String value, int expectedBytes, String fieldName) {
        requireHex(value, fieldName);
        if ((value.trim().length() / 2) != expectedBytes) {
            throw new IllegalArgumentException(fieldName + " 长度非法");
        }
    }

    private static void requireHexAtLeast(@Nullable String value, int minimumBytes, String fieldName) {
        requireHex(value, fieldName);
        if ((value.trim().length() / 2) < minimumBytes) {
            throw new IllegalArgumentException(fieldName + " 长度非法");
        }
    }

    private static void requireHex(@Nullable String value, String fieldName) {
        String normalized = requireText(value, fieldName).trim();
        if ((normalized.length() % 2) != 0) {
            throw new IllegalArgumentException(fieldName + " 长度非法");
        }

        for (int index = 0; index < normalized.length(); index += 1) {
            if (Character.digit(normalized.charAt(index), 16) < 0) {
                throw new IllegalArgumentException(fieldName + " 不是合法 hex");
            }
        }
    }

    private static String requireText(@Nullable String value, String fieldName) {
        if (!StringUtils.hasText(value)) {
            throw new IllegalArgumentException(fieldName + " 不能为空");
        }
        return value;
    }
}
