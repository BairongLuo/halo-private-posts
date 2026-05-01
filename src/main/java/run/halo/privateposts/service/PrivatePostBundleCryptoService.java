package run.halo.privateposts.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import run.halo.privateposts.model.PrivatePost;

@Service
public class PrivatePostBundleCryptoService {
    private static final String AES_ALGORITHM = "AES";
    private static final String AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int AES_GCM_TAG_BITS = 128;
    private static final int AES_GCM_TAG_BYTES = AES_GCM_TAG_BITS / 8;
    private static final int CONTENT_KEY_BYTES = 32;
    private static final int IV_BYTES = 12;
    private static final String PAYLOAD_FORMAT_MARKDOWN = "markdown";
    private static final String PAYLOAD_FORMAT_HTML = "html";
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper().findAndRegisterModules();

    private final SecureRandom secureRandom = new SecureRandom();

    public PrivatePost.Bundle reencryptWithContentKey(PrivatePost.Bundle sourceBundle,
                                                      byte[] contentKey,
                                                      String payloadFormat,
                                                      String content,
                                                      PrivatePost.BundleMetadata metadata) {
        validateContentKey(contentKey);
        String normalizedPayloadFormat = normalizePayloadFormat(payloadFormat);
        if (!StringUtils.hasText(content)) {
            throw new IllegalArgumentException("正文内容不能为空");
        }
        if (metadata == null || !StringUtils.hasText(metadata.getSlug()) || !StringUtils.hasText(metadata.getTitle())) {
            throw new IllegalArgumentException("metadata.slug 和 metadata.title 不能为空");
        }

        byte[] iv = new byte[IV_BYTES];
        secureRandom.nextBytes(iv);
        byte[] encryptedPayload = encryptAesGcm(contentKey, iv, buildPayloadBytes(normalizedPayloadFormat, content));

        PrivatePost.Bundle nextBundle = new PrivatePost.Bundle();
        nextBundle.setVersion(sourceBundle.getVersion());
        nextBundle.setPayloadFormat(normalizedPayloadFormat);
        nextBundle.setCipher(sourceBundle.getCipher());
        nextBundle.setKdf(sourceBundle.getKdf());
        nextBundle.setDataIv(bytesToHex(iv));
        nextBundle.setCiphertext(bytesToHex(slice(encryptedPayload, 0, encryptedPayload.length - AES_GCM_TAG_BYTES)));
        nextBundle.setAuthTag(bytesToHex(slice(encryptedPayload, encryptedPayload.length - AES_GCM_TAG_BYTES,
            encryptedPayload.length)));
        nextBundle.setPasswordSlot(copyPasswordSlot(sourceBundle.getPasswordSlot()));
        nextBundle.setSiteRecoverySlot(copySiteRecoverySlot(sourceBundle.getSiteRecoverySlot()));
        nextBundle.setMetadata(copyBundleMetadata(metadata));
        return nextBundle;
    }

    private byte[] encryptAesGcm(byte[] keyBytes, byte[] iv, byte[] plaintext) {
        try {
            Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
            cipher.init(
                Cipher.ENCRYPT_MODE,
                new SecretKeySpec(keyBytes, AES_ALGORITHM),
                new GCMParameterSpec(AES_GCM_TAG_BITS, iv)
            );
            return cipher.doFinal(plaintext);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Failed to encrypt private post content.", exception);
        }
    }

    private static byte[] buildPayloadBytes(String payloadFormat, String content) {
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("content", content);
        if (PAYLOAD_FORMAT_MARKDOWN.equals(payloadFormat)) {
            payload.put("markdown", content);
        }

        try {
            return OBJECT_MAPPER.writeValueAsString(payload).getBytes(StandardCharsets.UTF_8);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Failed to serialize private post payload.", exception);
        }
    }

    private static void validateContentKey(byte[] contentKey) {
        if (contentKey == null || contentKey.length != CONTENT_KEY_BYTES) {
            throw new IllegalArgumentException("内容密钥长度非法");
        }
    }

    private static String normalizePayloadFormat(String payloadFormat) {
        if (!StringUtils.hasText(payloadFormat)) {
            throw new IllegalArgumentException("payloadFormat 不能为空");
        }

        String normalized = payloadFormat.trim().toLowerCase();
        if (PAYLOAD_FORMAT_MARKDOWN.equals(normalized) || PAYLOAD_FORMAT_HTML.equals(normalized)) {
            return normalized;
        }

        throw new IllegalArgumentException("当前正文类型暂不支持，只支持 Markdown 或 HTML");
    }

    private static PrivatePost.PasswordSlot copyPasswordSlot(PrivatePost.PasswordSlot source) {
        if (source == null) {
            return null;
        }

        PrivatePost.PasswordSlot copied = new PrivatePost.PasswordSlot();
        copied.setKdf(source.getKdf());
        copied.setSalt(source.getSalt());
        copied.setWrapIv(source.getWrapIv());
        copied.setWrappedCek(source.getWrappedCek());
        copied.setAuthTag(source.getAuthTag());
        return copied;
    }

    private static PrivatePost.SiteRecoverySlot copySiteRecoverySlot(PrivatePost.SiteRecoverySlot source) {
        if (source == null) {
            return null;
        }

        PrivatePost.SiteRecoverySlot copied = new PrivatePost.SiteRecoverySlot();
        copied.setKid(source.getKid());
        copied.setAlg(source.getAlg());
        copied.setWrappedCek(source.getWrappedCek());
        return copied;
    }

    private static PrivatePost.BundleMetadata copyBundleMetadata(PrivatePost.BundleMetadata source) {
        if (source == null) {
            return null;
        }

        PrivatePost.BundleMetadata copied = new PrivatePost.BundleMetadata();
        copied.setSlug(source.getSlug());
        copied.setTitle(source.getTitle());
        copied.setExcerpt(source.getExcerpt());
        copied.setPublishedAt(source.getPublishedAt());
        return copied;
    }

    private static byte[] slice(byte[] value, int startInclusive, int endExclusive) {
        byte[] sliced = new byte[endExclusive - startInclusive];
        System.arraycopy(value, startInclusive, sliced, 0, sliced.length);
        return sliced;
    }

    private static String bytesToHex(byte[] value) {
        StringBuilder builder = new StringBuilder(value.length * 2);
        for (byte current : value) {
            builder.append(String.format("%02x", current));
        }
        return builder.toString();
    }
}
