package run.halo.privateposts.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Secret;

class SiteRecoveryKeyServiceTest {
    @Test
    void shouldCreateSiteRecoverySecretAndRoundTripContentKey() {
        ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        AtomicReference<Secret> storedSecret = new AtomicReference<>();
        when(client.fetch(eq(Secret.class), eq(SiteRecoveryKeyService.SECRET_NAME)))
            .thenAnswer(invocation -> {
                Secret secret = storedSecret.get();
                return secret == null ? Mono.empty() : Mono.just(secret);
            });
        doAnswer(invocation -> {
                Secret secret = invocation.getArgument(0);
                storedSecret.set(secret);
                return Mono.just(secret);
            })
            .when(client)
            .create(any(Secret.class));
        SiteRecoveryKeyService service = new SiteRecoveryKeyService(client);

        SiteRecoveryKeyService.SiteRecoveryPublicKey publicKey = service.ensurePublicKey().block();
        byte[] contentKey = sampleContentKey();
        byte[] wrapped = service.wrapForSiteRecovery(contentKey, publicKey.publicKey());

        assertThat(publicKey.kid()).isEqualTo(SiteRecoveryKeyService.KEY_ID);
        assertThat(publicKey.alg()).isEqualTo(SiteRecoveryKeyService.WRAP_ALGORITHM);
        assertThat(service.unwrap(wrapped).block()).containsExactly(contentKey);
        verify(client).create(any(Secret.class));
        verify(client, times(2)).fetch(Secret.class, SiteRecoveryKeyService.SECRET_NAME);
    }

    private static byte[] sampleContentKey() {
        byte[] value = new byte[32];
        IntStream.range(0, value.length).forEach(index -> value[index] = (byte) (index + 11));
        return value;
    }
}
