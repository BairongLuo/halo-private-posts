package run.halo.privateposts.router;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.test.web.reactive.server.WebTestClient;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.service.PasswordSlotCryptoService;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.service.SiteRecoveryKeyService;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;
import reactor.core.publisher.Mono;

class PrivatePostConsoleRouterTest {
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void shouldReturnSiteRecoveryPublicKeyForConsoleAdmin() {
        SiteRecoveryKeyService siteRecoveryKeyService = mock(SiteRecoveryKeyService.class);
        when(siteRecoveryKeyService.ensurePublicKey()).thenReturn(Mono.just(
            new SiteRecoveryKeyService.SiteRecoveryPublicKey(
                "site-recovery-rsa-oaep-sha256-v1",
                "RSA-OAEP-256",
                "public-key-base64"
            )
        ));
        WebTestClient client = bindClient(newRouter(
            siteRecoveryKeyService,
            mock(PasswordSlotCryptoService.class),
            mock(PrivatePostService.class),
            mock(ReactiveExtensionClient.class)
        ), authenticatedUser("admin"));

        client.get()
            .uri("/private-posts/site-recovery-key")
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.kid").isEqualTo("site-recovery-rsa-oaep-sha256-v1")
            .jsonPath("$.alg").isEqualTo("RSA-OAEP-256")
            .jsonPath("$.publicKey").isEqualTo("public-key-base64");
    }

    @Test
    void shouldRejectConsoleRouteWithoutAdminRole() {
        SiteRecoveryKeyService siteRecoveryKeyService = mock(SiteRecoveryKeyService.class);
        when(siteRecoveryKeyService.ensurePublicKey()).thenReturn(Mono.just(
            new SiteRecoveryKeyService.SiteRecoveryPublicKey(
                "site-recovery-rsa-oaep-sha256-v1",
                "RSA-OAEP-256",
                "public-key-base64"
            )
        ));
        WebTestClient client = bindClient(newRouter(
            siteRecoveryKeyService,
            mock(PasswordSlotCryptoService.class),
            mock(PrivatePostService.class),
            mock(ReactiveExtensionClient.class)
        ), null);

        client.get()
            .uri("/private-posts/site-recovery-key")
            .exchange()
            .expectStatus().isForbidden()
            .expectBody()
            .jsonPath("$.message").isEqualTo("当前用户没有平台恢复权限");
    }

    @Test
    void shouldResetPasswordWithSiteRecoveryAndPersistBundleToSourcePost() throws Exception {
        SiteRecoveryKeyService siteRecoveryKeyService = mock(SiteRecoveryKeyService.class);
        PasswordSlotCryptoService passwordSlotCryptoService = mock(PasswordSlotCryptoService.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        ReactiveExtensionClient extensionClient = mock(ReactiveExtensionClient.class);
        Post sourcePost = sourcePost("demo-post");
        PrivatePost.PasswordSlot nextPasswordSlot = passwordSlot("feedbeef", "somesalt", "deadbeef", "cafebabe");
        AtomicReference<Post> updatedPost = new AtomicReference<>();
        AtomicReference<PrivatePost> upsertedPrivatePost = new AtomicReference<>();

        when(extensionClient.fetch(Post.class, "demo-post")).thenReturn(Mono.just(sourcePost));
        when(siteRecoveryKeyService.unwrap(any(byte[].class))).thenReturn(Mono.just(sampleContentKey()));
        when(passwordSlotCryptoService.wrapContentKey(any(byte[].class), eq("NextPass#2026")))
            .thenReturn(nextPasswordSlot);
        when(extensionClient.update(any(Post.class))).thenAnswer(invocation -> {
            Post post = invocation.getArgument(0);
            updatedPost.set(post);
            return Mono.just(post);
        });
        when(privatePostService.upsert(any(PrivatePost.class))).thenAnswer(invocation -> {
            PrivatePost value = invocation.getArgument(0);
            upsertedPrivatePost.set(value);
            return Mono.just(value);
        });
        WebTestClient client = bindClient(newRouter(
            siteRecoveryKeyService,
            passwordSlotCryptoService,
            privatePostService,
            extensionClient
        ), authenticatedUser("editor"));

        client.post()
            .uri("/private-posts/reset-password")
            .bodyValue(Map.of(
                "postName", "demo-post",
                "nextPassword", "NextPass#2026"
            ))
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.message").isEqualTo("访问口令已通过平台恢复能力重置");

        verify(extensionClient).update(any(Post.class));
        verify(privatePostService).upsert(any(PrivatePost.class));
        assertThat(updatedPost.get()).isNotNull();
        assertThat(upsertedPrivatePost.get()).isNotNull();
        assertThat(upsertedPrivatePost.get().getSpec().getBundle().getPasswordSlot().getWrappedCek())
            .isEqualTo("deadbeef");

        String bundleText = updatedPost.get().getMetadata().getAnnotations()
            .get(PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION);
        JsonNode bundleJson = objectMapper.readTree(bundleText);
        assertThat(bundleJson.path("version").asInt()).isEqualTo(3);
        assertThat(bundleJson.path("site_recovery_slot").path("alg").asText()).isEqualTo("RSA-OAEP-256");
        assertThat(bundleJson.path("password_slot").path("wrapped_cek").asText()).isEqualTo("deadbeef");
        assertThat(bundleJson.path("password_slot").path("auth_tag").asText()).isEqualTo("cafebabe");
    }

    @Test
    void shouldResetPasswordUsingSourcePostBundleWhenPrivatePostMirrorIsMissing() throws Exception {
        SiteRecoveryKeyService siteRecoveryKeyService = mock(SiteRecoveryKeyService.class);
        PasswordSlotCryptoService passwordSlotCryptoService = mock(PasswordSlotCryptoService.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        ReactiveExtensionClient extensionClient = mock(ReactiveExtensionClient.class);
        Post sourcePost = sourcePost("demo-post");
        PrivatePost.PasswordSlot nextPasswordSlot = passwordSlot("feedbeef", "somesalt", "deadbeef", "cafebabe");

        when(extensionClient.fetch(Post.class, "demo-post")).thenReturn(Mono.just(sourcePost));
        when(siteRecoveryKeyService.unwrap(any(byte[].class))).thenReturn(Mono.just(sampleContentKey()));
        when(passwordSlotCryptoService.wrapContentKey(any(byte[].class), eq("NextPass#2026")))
            .thenReturn(nextPasswordSlot);
        when(extensionClient.update(any(Post.class))).thenAnswer(invocation -> Mono.just(invocation.getArgument(0)));
        when(privatePostService.upsert(any(PrivatePost.class))).thenAnswer(invocation -> Mono.just(invocation.getArgument(0)));
        WebTestClient client = bindClient(newRouter(
            siteRecoveryKeyService,
            passwordSlotCryptoService,
            privatePostService,
            extensionClient
        ), authenticatedUser("editor"));

        client.post()
            .uri("/private-posts/reset-password")
            .bodyValue(Map.of(
                "postName", "demo-post",
                "nextPassword", "NextPass#2026"
            ))
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.message").isEqualTo("访问口令已通过平台恢复能力重置");

        verify(extensionClient).fetch(Post.class, "demo-post");
        verify(privatePostService).upsert(any(PrivatePost.class));
    }

    @Test
    void shouldRejectInvalidSourceBundleBeforeTryingSiteRecoveryUnwrap() throws Exception {
        SiteRecoveryKeyService siteRecoveryKeyService = mock(SiteRecoveryKeyService.class);
        PasswordSlotCryptoService passwordSlotCryptoService = mock(PasswordSlotCryptoService.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        ReactiveExtensionClient extensionClient = mock(ReactiveExtensionClient.class);
        Post sourcePost = sourcePostWithBundleText(
            "demo-post",
            """
                {"version":3,"payload_format":"markdown","cipher":"aes-256-gcm",
                "kdf":"envelope","data_iv":"2233","ciphertext":"4455","auth_tag":"6677",
                "password_slot":{"kdf":"scrypt","salt":"0011","wrap_iv":"8899","wrapped_cek":"aabb","auth_tag":"ccdd"},
                "site_recovery_slot":{"kid":"site-recovery-rsa-oaep-sha256-v1","alg":"RSA-OAEP-256","wrapped_cek":"11223344"},
                "metadata":{"slug":"demo-post-slug","title":"Demo Post"}}
                """.trim()
        );

        when(extensionClient.fetch(Post.class, "demo-post")).thenReturn(Mono.just(sourcePost));
        WebTestClient client = bindClient(newRouter(
            siteRecoveryKeyService,
            passwordSlotCryptoService,
            privatePostService,
            extensionClient
        ), authenticatedUser("editor"));

        client.post()
            .uri("/private-posts/reset-password")
            .bodyValue(Map.of(
                "postName", "demo-post",
                "nextPassword", "NextPass#2026"
            ))
            .exchange()
            .expectStatus().isBadRequest()
            .expectBody()
            .jsonPath("$.message").isEqualTo("当前文章的私密正文 bundle 无效，请重新加锁后再使用平台恢复");
    }

    @Test
    void shouldRejectBundleWithoutSiteRecoverySlot() throws Exception {
        SiteRecoveryKeyService siteRecoveryKeyService = mock(SiteRecoveryKeyService.class);
        PasswordSlotCryptoService passwordSlotCryptoService = mock(PasswordSlotCryptoService.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        ReactiveExtensionClient extensionClient = mock(ReactiveExtensionClient.class);
        Post sourcePost = sourcePostWithBundleText(
            "demo-post",
            """
                {"version":3,"payload_format":"markdown","cipher":"aes-256-gcm","kdf":"envelope",
                "data_iv":"00112233445566778899aabb",
                "ciphertext":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
                "auth_tag":"00112233445566778899aabbccddeeff",
                "password_slot":{"kdf":"scrypt","salt":"00112233445566778899aabbccddeeff",
                "wrap_iv":"00112233445566778899aabb","wrapped_cek":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
                "auth_tag":"00112233445566778899aabbccddeeff"},
                "metadata":{"slug":"demo-post-slug","title":"Demo Post"}}
                """.trim()
        );

        when(extensionClient.fetch(Post.class, "demo-post")).thenReturn(Mono.just(sourcePost));
        WebTestClient client = bindClient(newRouter(
            siteRecoveryKeyService,
            passwordSlotCryptoService,
            privatePostService,
            extensionClient
        ), authenticatedUser("editor"));

        client.post()
            .uri("/private-posts/reset-password")
            .bodyValue(Map.of(
                "postName", "demo-post",
                "nextPassword", "NextPass#2026"
            ))
            .exchange()
            .expectStatus().isBadRequest()
            .expectBody()
            .jsonPath("$.message").isEqualTo("当前文章还没有平台恢复槽，不能直接后台重置口令");
    }

    @Test
    void shouldRejectBundleWithInvalidSiteRecoverySlot() throws Exception {
        SiteRecoveryKeyService siteRecoveryKeyService = mock(SiteRecoveryKeyService.class);
        PasswordSlotCryptoService passwordSlotCryptoService = mock(PasswordSlotCryptoService.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        ReactiveExtensionClient extensionClient = mock(ReactiveExtensionClient.class);
        Post sourcePost = sourcePostWithBundleText(
            "demo-post",
            """
                {"version":3,"payload_format":"markdown","cipher":"aes-256-gcm","kdf":"envelope",
                "data_iv":"00112233445566778899aabb",
                "ciphertext":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
                "auth_tag":"00112233445566778899aabbccddeeff",
                "password_slot":{"kdf":"scrypt","salt":"00112233445566778899aabbccddeeff",
                "wrap_iv":"00112233445566778899aabb","wrapped_cek":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
                "auth_tag":"00112233445566778899aabbccddeeff"},
                "site_recovery_slot":{"kid":"site-recovery-rsa-oaep-sha256-v1","alg":"RSA-OAEP-256","wrapped_cek":"11223344"},
                "metadata":{"slug":"demo-post-slug","title":"Demo Post"}}
                """.trim()
        );

        when(extensionClient.fetch(Post.class, "demo-post")).thenReturn(Mono.just(sourcePost));
        WebTestClient client = bindClient(newRouter(
            siteRecoveryKeyService,
            passwordSlotCryptoService,
            privatePostService,
            extensionClient
        ), authenticatedUser("editor"));

        client.post()
            .uri("/private-posts/reset-password")
            .bodyValue(Map.of(
                "postName", "demo-post",
                "nextPassword", "NextPass#2026"
            ))
            .exchange()
            .expectStatus().isBadRequest()
            .expectBody()
            .jsonPath("$.message").isEqualTo("当前文章的私密正文 bundle 无效，请重新加锁后再使用平台恢复");
    }

    @Test
    void shouldAllowConsoleRouteForAuthenticatedConsoleUser() {
        SiteRecoveryKeyService siteRecoveryKeyService = mock(SiteRecoveryKeyService.class);
        when(siteRecoveryKeyService.ensurePublicKey()).thenReturn(Mono.just(
            new SiteRecoveryKeyService.SiteRecoveryPublicKey(
                "site-recovery-rsa-oaep-sha256-v1",
                "RSA-OAEP-256",
                "public-key-base64"
            )
        ));
        WebTestClient client = bindClient(newRouter(
            siteRecoveryKeyService,
            mock(PasswordSlotCryptoService.class),
            mock(PrivatePostService.class),
            mock(ReactiveExtensionClient.class)
        ), authenticatedUser("author"));

        client.get()
            .uri("/private-posts/site-recovery-key")
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.kid").isEqualTo("site-recovery-rsa-oaep-sha256-v1");
    }

    private PrivatePostConsoleRouter newRouter(SiteRecoveryKeyService siteRecoveryKeyService,
                                               PasswordSlotCryptoService passwordSlotCryptoService,
                                               PrivatePostService privatePostService,
                                               ReactiveExtensionClient extensionClient) {
        return new PrivatePostConsoleRouter(
            siteRecoveryKeyService,
            passwordSlotCryptoService,
            privatePostService,
            extensionClient
        );
    }

    private WebTestClient bindClient(PrivatePostConsoleRouter router,
                                     UsernamePasswordAuthenticationToken authentication) {
        WebTestClient.RouterFunctionSpec spec = WebTestClient.bindToRouterFunction(
            router.endpoint()
        );
        if (authentication == null) {
            return spec.build();
        }

        return spec
            .webFilter((exchange, chain) -> chain.filter(exchange)
                .contextWrite(ReactiveSecurityContextHolder.withAuthentication(authentication)))
            .build();
    }

    private static UsernamePasswordAuthenticationToken authenticatedUser(String username, String... authorities) {
        return UsernamePasswordAuthenticationToken.authenticated(
            username,
            "n/a",
            AuthorityUtils.createAuthorityList(authorities)
        );
    }

    private static PrivatePost privatePost(String postName) {
        PrivatePost privatePost = new PrivatePost();
        Metadata metadata = new Metadata();
        metadata.setName(postName);
        privatePost.setMetadata(metadata);

        PrivatePost.Bundle bundle = new PrivatePost.Bundle();
        bundle.setVersion(3);
        bundle.setPayloadFormat("markdown");
        bundle.setCipher("aes-256-gcm");
        bundle.setKdf("envelope");
        bundle.setDataIv("00112233445566778899aabb");
        bundle.setCiphertext("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
        bundle.setAuthTag("00112233445566778899aabbccddeeff");
        bundle.setPasswordSlot(passwordSlot(
            "00112233445566778899aabb",
            "00112233445566778899aabbccddeeff",
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            "00112233445566778899aabbccddeeff"
        ));
        PrivatePost.SiteRecoverySlot siteRecoverySlot = new PrivatePost.SiteRecoverySlot();
        siteRecoverySlot.setKid("site-recovery-rsa-oaep-sha256-v1");
        siteRecoverySlot.setAlg("RSA-OAEP-256");
        siteRecoverySlot.setWrappedCek(repeatHex("11", 384));
        bundle.setSiteRecoverySlot(siteRecoverySlot);
        PrivatePost.BundleMetadata bundleMetadata = new PrivatePost.BundleMetadata();
        bundleMetadata.setSlug("demo-post-slug");
        bundleMetadata.setTitle("Demo Post");
        bundle.setMetadata(bundleMetadata);

        PrivatePost.PrivatePostSpec spec = new PrivatePost.PrivatePostSpec();
        spec.setPostName(postName);
        spec.setSlug("demo-post-slug");
        spec.setTitle("Demo Post");
        spec.setExcerpt("post excerpt");
        spec.setPublishedAt("2026-04-28T00:00:00Z");
        spec.setBundle(bundle);
        privatePost.setSpec(spec);
        return privatePost;
    }

    private Post sourcePost(String postName) throws Exception {
        return sourcePostWithBundleText(
            postName,
            objectMapper.writeValueAsString(privatePost(postName).getSpec().getBundle())
        );
    }

    private Post sourcePostWithBundleText(String postName, String bundleText) {
        Post post = new Post();
        Metadata metadata = new Metadata();
        metadata.setName(postName);
        metadata.setAnnotations(new LinkedHashMap<>(Map.of(
            PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION,
            bundleText
        )));
        post.setMetadata(metadata);

        Post.PostSpec spec = new Post.PostSpec();
        spec.setSlug("demo-post-slug");
        spec.setTitle("Demo Post");
        Post.Excerpt excerpt = new Post.Excerpt();
        excerpt.setRaw("post excerpt");
        spec.setExcerpt(excerpt);
        post.setSpec(spec);
        return post;
    }

    private static PrivatePost.PasswordSlot passwordSlot(String wrapIv,
                                                         String salt,
                                                         String wrappedCek,
                                                         String authTag) {
        PrivatePost.PasswordSlot slot = new PrivatePost.PasswordSlot();
        slot.setKdf("scrypt");
        slot.setWrapIv(wrapIv);
        slot.setSalt(salt);
        slot.setWrappedCek(wrappedCek);
        slot.setAuthTag(authTag);
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

    private static String repeatHex(String byteHex, int byteCount) {
        return byteHex.repeat(byteCount);
    }
}
