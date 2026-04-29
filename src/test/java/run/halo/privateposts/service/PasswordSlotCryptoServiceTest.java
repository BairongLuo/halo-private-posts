package run.halo.privateposts.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import run.halo.privateposts.model.PrivatePost;

class PasswordSlotCryptoServiceTest {
    private final PasswordSlotCryptoService service = new PasswordSlotCryptoService();

    @Test
    void shouldWrapAndUnwrapContentKeyWithPassword() {
        byte[] contentKey = sampleContentKey();

        PrivatePost.PasswordSlot passwordSlot = service.wrapContentKey(contentKey, "Halo#2026");

        assertThat(passwordSlot.getKdf()).isEqualTo("scrypt");
        assertThat(service.unwrapContentKey(passwordSlot, "Halo#2026")).containsExactly(contentKey);
    }

    @Test
    void shouldRejectWrongPasswordWhenUnwrappingContentKey() {
        PrivatePost.PasswordSlot passwordSlot = service.wrapContentKey(sampleContentKey(), "Halo#2026");

        assertThatThrownBy(() -> service.unwrapContentKey(passwordSlot, "wrong-password"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("访问密码错误，或密文已损坏");
    }

    @Test
    void shouldMatchKnownScryptVector() {
        byte[] derivedKey = PasswordSlotCryptoService.deriveScryptKey(
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

    private static byte[] sampleContentKey() {
        byte[] value = new byte[32];
        IntStream.range(0, value.length).forEach(index -> value[index] = (byte) (index + 1));
        return value;
    }

    private static String toHex(byte[] value) {
        StringBuilder builder = new StringBuilder(value.length * 2);
        for (byte current : value) {
            builder.append(String.format("%02x", current));
        }
        return builder.toString();
    }
}
