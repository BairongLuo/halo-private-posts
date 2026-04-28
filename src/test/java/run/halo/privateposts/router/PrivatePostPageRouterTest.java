package run.halo.privateposts.router;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.HandlerStrategies;
import org.springframework.web.reactive.result.view.View;
import org.springframework.web.reactive.result.view.ViewResolver;
import reactor.core.publisher.Mono;
import run.halo.app.theme.TemplateNameResolver;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.view.PrivatePostView;

class PrivatePostPageRouterTest {
    @Test
    void shouldReturnBundleDataFromPublicSourceView() {
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        TemplateNameResolver templateNameResolver = mock(TemplateNameResolver.class);
        when(privatePostService.getPublicViewBySlug("hello-halo"))
            .thenReturn(Mono.just(privatePostView("hello-halo")));
        WebTestClient client = bindClient(
            new PrivatePostPageRouter(templateNameResolver, privatePostService)
        );

        client.get()
            .uri("/private-posts/data?slug=hello-halo")
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.slug").isEqualTo("hello-halo")
            .jsonPath("$.title").isEqualTo("Hello Halo")
            .jsonPath("$.bundle.metadata.slug").isEqualTo("hello-halo");
    }

    @Test
    void shouldRenderReaderPageFromPublicSourceView() {
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        TemplateNameResolver templateNameResolver = mock(TemplateNameResolver.class);
        when(privatePostService.getPublicViewBySlug("hello-halo"))
            .thenReturn(Mono.just(privatePostView("hello-halo")));
        when(templateNameResolver.resolveTemplateNameOrDefault(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("private-post")))
            .thenReturn(Mono.just("private-post"));
        WebTestClient client = bindClient(
            new PrivatePostPageRouter(templateNameResolver, privatePostService)
        );

        client.get()
            .uri("/private-posts?slug=hello-halo")
            .exchange()
            .expectStatus().isOk()
            .expectBody(String.class)
            .value(body -> org.assertj.core.api.Assertions.assertThat(body).contains("Hello Halo"));
    }

    private WebTestClient bindClient(PrivatePostPageRouter router) {
        ViewResolver viewResolver = (viewName, locale) -> Mono.just((View) (model, contentType, exchange) -> {
            byte[] body = String.valueOf(model.get("title")).getBytes(StandardCharsets.UTF_8);
            exchange.getResponse().getHeaders().set("Content-Type", "text/plain;charset=UTF-8");
            org.springframework.core.io.buffer.DataBuffer buffer =
                exchange.getResponse().bufferFactory().wrap(body);
            return exchange.getResponse().writeWith(Mono.just(buffer));
        });

        return WebTestClient.bindToWebHandler(
            RouterFunctions.toWebHandler(
                router.privatePostRouterFunction(),
                HandlerStrategies.builder().viewResolver(viewResolver).build()
            )
        ).build();
    }

    private static PrivatePostView privatePostView(String slug) {
        PrivatePost.Bundle bundle = new PrivatePost.Bundle();
        bundle.setVersion(3);
        bundle.setPayloadFormat("markdown");
        bundle.setCipher("aes-256-gcm");
        bundle.setKdf("envelope");
        bundle.setDataIv("00112233445566778899aabb");
        bundle.setCiphertext("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
        bundle.setAuthTag("00112233445566778899aabbccddeeff");

        PrivatePost.PasswordSlot passwordSlot = new PrivatePost.PasswordSlot();
        passwordSlot.setKdf("scrypt");
        passwordSlot.setSalt("00112233445566778899aabbccddeeff");
        passwordSlot.setWrapIv("00112233445566778899aabb");
        passwordSlot.setWrappedCek("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
        passwordSlot.setAuthTag("00112233445566778899aabbccddeeff");
        bundle.setPasswordSlot(passwordSlot);

        PrivatePost.SiteRecoverySlot siteRecoverySlot = new PrivatePost.SiteRecoverySlot();
        siteRecoverySlot.setKid("site-recovery-rsa-oaep-sha256-v1");
        siteRecoverySlot.setAlg("RSA-OAEP-256");
        siteRecoverySlot.setWrappedCek(repeatHex("11", 384));
        bundle.setSiteRecoverySlot(siteRecoverySlot);

        PrivatePost.BundleMetadata metadata = new PrivatePost.BundleMetadata();
        metadata.setSlug(slug);
        metadata.setTitle("Hello Halo");
        bundle.setMetadata(metadata);

        return new PrivatePostView(
            "source-post",
            "source-post",
            slug,
            "Hello Halo",
            "公开摘要",
            "2026-04-28T00:00:00Z",
            "/private-posts?slug=" + slug,
            "/private-posts/data?slug=" + slug,
            bundle
        );
    }

    private static String repeatHex(String byteHex, int byteCount) {
        return byteHex.repeat(byteCount);
    }
}
