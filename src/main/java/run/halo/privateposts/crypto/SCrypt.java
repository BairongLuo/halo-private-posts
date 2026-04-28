package run.halo.privateposts.crypto;

import static java.lang.Integer.MAX_VALUE;
import static java.lang.System.arraycopy;

import java.security.GeneralSecurityException;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/*
 * Adapted from the Apache-2.0-licensed scrypt implementation by Will Glozer:
 * https://github.com/wg/scrypt
 */
public final class SCrypt {
    private static final String HMAC_SHA256 = "HmacSHA256";

    private SCrypt() {
    }

    public static byte[] deriveKey(byte[] password, byte[] salt, int n, int r, int p, int dkLen) {
        if (n < 2 || (n & (n - 1)) != 0) {
            throw new IllegalArgumentException("N must be a power of 2 greater than 1");
        }
        if (n > MAX_VALUE / 128 / r) {
            throw new IllegalArgumentException("Parameter N is too large");
        }
        if (r > MAX_VALUE / 128 / p) {
            throw new IllegalArgumentException("Parameter r is too large");
        }

        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(password, HMAC_SHA256));

            byte[] derivedKey = new byte[dkLen];
            byte[] block = new byte[128 * r * p];
            byte[] xy = new byte[256 * r];
            byte[] v = new byte[128 * r * n];

            pbkdf2(mac, salt, 1, block, p * 128 * r);
            for (int index = 0; index < p; index++) {
                smix(block, index * 128 * r, r, n, v, xy);
            }
            pbkdf2(mac, block, 1, derivedKey, dkLen);
            return derivedKey;
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Failed to derive password key with scrypt.", exception);
        }
    }

    private static void pbkdf2(Mac mac, byte[] salt, int iterations, byte[] derivedKey, int dkLen)
        throws GeneralSecurityException {
        int hashLength = mac.getMacLength();
        if (dkLen > (Math.pow(2, 32) - 1) * hashLength) {
            throw new GeneralSecurityException("Requested key length too long");
        }

        byte[] u = new byte[hashLength];
        byte[] t = new byte[hashLength];
        byte[] block = new byte[salt.length + 4];

        int blocks = (int) Math.ceil((double) dkLen / hashLength);
        int remainder = dkLen - (blocks - 1) * hashLength;

        arraycopy(salt, 0, block, 0, salt.length);

        for (int index = 1; index <= blocks; index++) {
            block[salt.length] = (byte) (index >> 24 & 0xff);
            block[salt.length + 1] = (byte) (index >> 16 & 0xff);
            block[salt.length + 2] = (byte) (index >> 8 & 0xff);
            block[salt.length + 3] = (byte) (index & 0xff);

            mac.update(block);
            mac.doFinal(u, 0);
            arraycopy(u, 0, t, 0, hashLength);

            for (int iteration = 1; iteration < iterations; iteration++) {
                mac.update(u);
                mac.doFinal(u, 0);
                for (int byteIndex = 0; byteIndex < hashLength; byteIndex++) {
                    t[byteIndex] ^= u[byteIndex];
                }
            }

            arraycopy(t, 0, derivedKey, (index - 1) * hashLength, index == blocks ? remainder : hashLength);
        }
    }

    private static void smix(byte[] block, int blockIndex, int r, int n, byte[] v, byte[] xy) {
        int xIndex = 0;
        int yIndex = 128 * r;

        arraycopy(block, blockIndex, xy, xIndex, 128 * r);

        for (int index = 0; index < n; index++) {
            arraycopy(xy, xIndex, v, index * (128 * r), 128 * r);
            blockMixSalsa8(xy, xIndex, yIndex, r);
        }

        for (int index = 0; index < n; index++) {
            int j = integerify(xy, xIndex, r) & (n - 1);
            blockXor(v, j * (128 * r), xy, xIndex, 128 * r);
            blockMixSalsa8(xy, xIndex, yIndex, r);
        }

        arraycopy(xy, xIndex, block, blockIndex, 128 * r);
    }

    private static void blockMixSalsa8(byte[] by, int blockIndex, int yIndex, int r) {
        byte[] x = new byte[64];
        arraycopy(by, blockIndex + (2 * r - 1) * 64, x, 0, 64);

        for (int index = 0; index < 2 * r; index++) {
            blockXor(by, blockIndex + index * 64, x, 0, 64);
            salsa20_8(x);
            arraycopy(x, 0, by, yIndex + index * 64, 64);
        }

        for (int index = 0; index < r; index++) {
            arraycopy(by, yIndex + index * 2 * 64, by, blockIndex + index * 64, 64);
        }
        for (int index = 0; index < r; index++) {
            arraycopy(by, yIndex + (index * 2 + 1) * 64, by, blockIndex + (index + r) * 64, 64);
        }
    }

    private static void salsa20_8(byte[] block) {
        int[] block32 = new int[16];
        int[] x = new int[16];

        for (int index = 0; index < 16; index++) {
            block32[index] = (block[index * 4] & 0xff);
            block32[index] |= (block[index * 4 + 1] & 0xff) << 8;
            block32[index] |= (block[index * 4 + 2] & 0xff) << 16;
            block32[index] |= (block[index * 4 + 3] & 0xff) << 24;
        }

        arraycopy(block32, 0, x, 0, 16);

        for (int index = 8; index > 0; index -= 2) {
            x[4] ^= rotateLeft(x[0] + x[12], 7);
            x[8] ^= rotateLeft(x[4] + x[0], 9);
            x[12] ^= rotateLeft(x[8] + x[4], 13);
            x[0] ^= rotateLeft(x[12] + x[8], 18);
            x[9] ^= rotateLeft(x[5] + x[1], 7);
            x[13] ^= rotateLeft(x[9] + x[5], 9);
            x[1] ^= rotateLeft(x[13] + x[9], 13);
            x[5] ^= rotateLeft(x[1] + x[13], 18);
            x[14] ^= rotateLeft(x[10] + x[6], 7);
            x[2] ^= rotateLeft(x[14] + x[10], 9);
            x[6] ^= rotateLeft(x[2] + x[14], 13);
            x[10] ^= rotateLeft(x[6] + x[2], 18);
            x[3] ^= rotateLeft(x[15] + x[11], 7);
            x[7] ^= rotateLeft(x[3] + x[15], 9);
            x[11] ^= rotateLeft(x[7] + x[3], 13);
            x[15] ^= rotateLeft(x[11] + x[7], 18);
            x[1] ^= rotateLeft(x[0] + x[3], 7);
            x[2] ^= rotateLeft(x[1] + x[0], 9);
            x[3] ^= rotateLeft(x[2] + x[1], 13);
            x[0] ^= rotateLeft(x[3] + x[2], 18);
            x[6] ^= rotateLeft(x[5] + x[4], 7);
            x[7] ^= rotateLeft(x[6] + x[5], 9);
            x[4] ^= rotateLeft(x[7] + x[6], 13);
            x[5] ^= rotateLeft(x[4] + x[7], 18);
            x[11] ^= rotateLeft(x[10] + x[9], 7);
            x[8] ^= rotateLeft(x[11] + x[10], 9);
            x[9] ^= rotateLeft(x[8] + x[11], 13);
            x[10] ^= rotateLeft(x[9] + x[8], 18);
            x[12] ^= rotateLeft(x[15] + x[14], 7);
            x[13] ^= rotateLeft(x[12] + x[15], 9);
            x[14] ^= rotateLeft(x[13] + x[12], 13);
            x[15] ^= rotateLeft(x[14] + x[13], 18);
        }

        for (int index = 0; index < 16; index++) {
            block32[index] = x[index] + block32[index];
        }

        for (int index = 0; index < 16; index++) {
            block[index * 4] = (byte) (block32[index] & 0xff);
            block[index * 4 + 1] = (byte) (block32[index] >> 8 & 0xff);
            block[index * 4 + 2] = (byte) (block32[index] >> 16 & 0xff);
            block[index * 4 + 3] = (byte) (block32[index] >> 24 & 0xff);
        }
    }

    private static void blockXor(byte[] source, int sourceIndex, byte[] destination, int destinationIndex, int length) {
        for (int index = 0; index < length; index++) {
            destination[destinationIndex + index] ^= source[sourceIndex + index];
        }
    }

    private static int integerify(byte[] block, int blockIndex, int r) {
        int index = blockIndex + (2 * r - 1) * 64;
        int result = block[index] & 0xff;
        result |= (block[index + 1] & 0xff) << 8;
        result |= (block[index + 2] & 0xff) << 16;
        result |= (block[index + 3] & 0xff) << 24;
        return result;
    }

    private static int rotateLeft(int value, int distance) {
        return value << distance | value >>> (32 - distance);
    }
}
