package run.halo.privateposts.service;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import reactor.core.publisher.Mono;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.extension.Secret;

@Service
public class SiteRecoveryKeyService {
    public static final String SECRET_NAME = "halo-private-posts-site-recovery";
    public static final String KEY_ID = "site-recovery-rsa-oaep-sha256-v1";
    public static final String WRAP_ALGORITHM = "RSA-OAEP-256";
    private static final String SECRET_TYPE = Secret.SECRET_TYPE_OPAQUE;
    private static final String PRIVATE_KEY_FIELD = "privateKeyPkcs8";
    private static final String PUBLIC_KEY_FIELD = "publicKeySpki";
    private static final OAEPParameterSpec OAEP_SHA256 = new OAEPParameterSpec(
        "SHA-256",
        "MGF1",
        MGF1ParameterSpec.SHA256,
        PSource.PSpecified.DEFAULT
    );

    private final ReactiveExtensionClient client;

    public SiteRecoveryKeyService(ReactiveExtensionClient client) {
        this.client = client;
    }

    public Mono<SiteRecoveryPublicKey> ensurePublicKey() {
        return fetchOrCreateSecret()
            .map(this::toPublicKey);
    }

    public Mono<byte[]> unwrap(byte[] wrappedContentKey) {
        return fetchOrCreateSecret()
            .map(this::readPrivateKey)
            .map(privateKey -> unwrapWithPrivateKey(privateKey, wrappedContentKey));
    }

    private Mono<Secret> fetchOrCreateSecret() {
        return client.fetch(Secret.class, SECRET_NAME)
            .switchIfEmpty(Mono.defer(this::createSiteRecoverySecret));
    }

    private Mono<Secret> createSiteRecoverySecret() {
        KeyPair pair = generateKeyPair();
        Secret secret = new Secret();
        Metadata metadata = new Metadata();
        metadata.setName(SECRET_NAME);
        secret.setMetadata(metadata);
        secret.setType(SECRET_TYPE);
        secret.setStringData(Map.of(
            PRIVATE_KEY_FIELD, Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()),
            PUBLIC_KEY_FIELD, Base64.getEncoder().encodeToString(pair.getPublic().getEncoded())
        ));
        return client.create(secret)
            .onErrorResume(error -> client.fetch(Secret.class, SECRET_NAME));
    }

    private KeyPair generateKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(3072);
            return generator.generateKeyPair();
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Failed to generate site recovery key pair.", exception);
        }
    }

    private SiteRecoveryPublicKey toPublicKey(Secret secret) {
        String publicKeyBase64 = readSecretString(secret, PUBLIC_KEY_FIELD);
        return new SiteRecoveryPublicKey(
            KEY_ID,
            WRAP_ALGORITHM,
            publicKeyBase64
        );
    }

    private PrivateKey readPrivateKey(Secret secret) {
        String privateKeyBase64 = readSecretString(secret, PRIVATE_KEY_FIELD);
        try {
            byte[] decoded = Base64.getDecoder().decode(privateKeyBase64);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            return keyFactory.generatePrivate(new PKCS8EncodedKeySpec(decoded));
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new IllegalStateException("Invalid site recovery private key.", exception);
        }
    }

    public PublicKey parsePublicKey(String publicKeyBase64) {
        try {
            byte[] decoded = Base64.getDecoder().decode(publicKeyBase64);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            return keyFactory.generatePublic(new X509EncodedKeySpec(decoded));
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new IllegalStateException("Invalid site recovery public key.", exception);
        }
    }

    public byte[] wrapForSiteRecovery(byte[] contentKey, String publicKeyBase64) {
        PublicKey publicKey = parsePublicKey(publicKeyBase64);
        return wrapWithPublicKey(contentKey, publicKey);
    }

    private byte[] wrapWithPublicKey(byte[] contentKey, PublicKey publicKey) {
        try {
            Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
            cipher.init(Cipher.ENCRYPT_MODE, publicKey, OAEP_SHA256);
            return cipher.doFinal(contentKey);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Failed to wrap content key for site recovery.", exception);
        }
    }

    private byte[] unwrapWithPrivateKey(PrivateKey privateKey, byte[] wrappedContentKey) {
        try {
            Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
            cipher.init(Cipher.DECRYPT_MODE, privateKey, OAEP_SHA256);
            return cipher.doFinal(wrappedContentKey);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Failed to unwrap content key with site recovery key.", exception);
        }
    }

    private static String readSecretString(Secret secret, String key) {
        if (secret == null) {
            throw new IllegalStateException("Site recovery secret is missing.");
        }

        Map<String, byte[]> data = secret.getData() == null ? Map.of() : secret.getData();
        byte[] rawValue = data.get(key);
        if (rawValue != null && rawValue.length > 0) {
            return new String(rawValue, StandardCharsets.UTF_8);
        }

        Map<String, String> stringData = secret.getStringData() == null
            ? new LinkedHashMap<>()
            : new LinkedHashMap<>(secret.getStringData());
        String value = stringData.get(key);
        if (!StringUtils.hasText(value)) {
            throw new IllegalStateException("Site recovery secret field is missing: " + key);
        }
        return value;
    }

    public record SiteRecoveryPublicKey(String kid, String alg, String publicKey) {
    }
}
