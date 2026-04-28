package run.halo.privateposts.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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

    private static byte[] sampleContentKey() {
        byte[] value = new byte[32];
        IntStream.range(0, value.length).forEach(index -> value[index] = (byte) (index + 1));
        return value;
    }
}
