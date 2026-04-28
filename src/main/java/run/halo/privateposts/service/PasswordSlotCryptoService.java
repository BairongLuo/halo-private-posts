package run.halo.privateposts.service;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import run.halo.privateposts.crypto.SCrypt;
import org.springframework.stereotype.Service;
import run.halo.privateposts.model.PrivatePost;

@Service
public class PasswordSlotCryptoService {
    private static final String PASSWORD_SLOT_KDF = "scrypt";
    private static final String AES_ALGORITHM = "AES";
    private static final String AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int AES_GCM_TAG_BITS = 128;
    private static final int AES_GCM_TAG_BYTES = AES_GCM_TAG_BITS / 8;
    private static final int SALT_BYTES = 16;
    private static final int IV_BYTES = 12;
    private static final int SCRYPT_N = 1 << 15;
    private static final int SCRYPT_R = 8;
    private static final int SCRYPT_P = 1;
    private static final int KEY_BYTES = 32;

    private final SecureRandom secureRandom = new SecureRandom();

    public byte[] unwrapContentKey(PrivatePost.PasswordSlot passwordSlot, String password) {
        byte[] salt = hexToBytes(passwordSlot.getSalt());
        byte[] iv = hexToBytes(passwordSlot.getWrapIv());
        byte[] ciphertext = hexToBytes(passwordSlot.getWrappedCek());
        byte[] authTag = hexToBytes(passwordSlot.getAuthTag());
        byte[] keyBytes = derivePasswordKey(password, salt);
        return decryptAesGcm(keyBytes, iv, join(ciphertext, authTag));
    }

    public PrivatePost.PasswordSlot wrapContentKey(byte[] contentKey, String password) {
        byte[] salt = new byte[SALT_BYTES];
        byte[] iv = new byte[IV_BYTES];
        secureRandom.nextBytes(salt);
        secureRandom.nextBytes(iv);

        byte[] keyBytes = derivePasswordKey(password, salt);
        byte[] encrypted = encryptAesGcm(keyBytes, iv, contentKey);
        PrivatePost.PasswordSlot passwordSlot = new PrivatePost.PasswordSlot();
        passwordSlot.setKdf(PASSWORD_SLOT_KDF);
        passwordSlot.setSalt(bytesToHex(salt));
        passwordSlot.setWrapIv(bytesToHex(iv));
        passwordSlot.setWrappedCek(bytesToHex(slice(encrypted, 0, encrypted.length - AES_GCM_TAG_BYTES)));
        passwordSlot.setAuthTag(bytesToHex(slice(encrypted, encrypted.length - AES_GCM_TAG_BYTES, encrypted.length)));
        return passwordSlot;
    }

    private byte[] derivePasswordKey(String password, byte[] salt) {
        return SCrypt.deriveKey(
            password.getBytes(StandardCharsets.UTF_8),
            salt,
            SCRYPT_N,
            SCRYPT_R,
            SCRYPT_P,
            KEY_BYTES
        );
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
            throw new IllegalStateException("Failed to encrypt password slot.", exception);
        }
    }

    private byte[] decryptAesGcm(byte[] keyBytes, byte[] iv, byte[] ciphertextAndTag) {
        try {
            Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
            cipher.init(
                Cipher.DECRYPT_MODE,
                new SecretKeySpec(keyBytes, AES_ALGORITHM),
                new GCMParameterSpec(AES_GCM_TAG_BITS, iv)
            );
            return cipher.doFinal(ciphertextAndTag);
        } catch (GeneralSecurityException exception) {
            throw new IllegalArgumentException("访问密码错误，或密文已损坏", exception);
        }
    }

    private static byte[] slice(byte[] source, int from, int to) {
        byte[] result = new byte[to - from];
        System.arraycopy(source, from, result, 0, result.length);
        return result;
    }

    private static byte[] join(byte[] left, byte[] right) {
        byte[] result = new byte[left.length + right.length];
        System.arraycopy(left, 0, result, 0, left.length);
        System.arraycopy(right, 0, result, left.length, right.length);
        return result;
    }

    private static String bytesToHex(byte[] value) {
        StringBuilder builder = new StringBuilder(value.length * 2);
        for (byte current : value) {
            builder.append(String.format("%02x", current));
        }
        return builder.toString();
    }

    private static byte[] hexToBytes(String value) {
        String hex = value == null ? "" : value.trim();
        if (hex.isEmpty() || (hex.length() % 2) != 0) {
            throw new IllegalArgumentException("Bundle 中存在非法 hex 字段");
        }

        byte[] result = new byte[hex.length() / 2];
        for (int index = 0; index < hex.length(); index += 2) {
            result[index / 2] = (byte) Integer.parseInt(hex.substring(index, index + 2), 16);
        }
        return result;
    }
}
