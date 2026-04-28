package run.halo.privateposts.crypto;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class SCryptTest {
    @Test
    void shouldMatchKnownRfcVectorForPasswordAndNaCl() {
        byte[] derivedKey = SCrypt.deriveKey(
            "password".getBytes(StandardCharsets.UTF_8),
            "NaCl".getBytes(StandardCharsets.UTF_8),
            1024,
            8,
            16,
            64
        );

        assertThat(toHex(derivedKey))
            .isEqualTo(
                "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162"
                    + "2eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640"
            );
    }

    private static String toHex(byte[] value) {
        StringBuilder builder = new StringBuilder(value.length * 2);
        for (byte current : value) {
            builder.append(String.format("%02x", current));
        }
        return builder.toString();
    }
}
