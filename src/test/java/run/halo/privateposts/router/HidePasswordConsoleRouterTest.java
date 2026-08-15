package run.halo.privateposts.router;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.test.web.reactive.server.WebTestClient;
import run.halo.privateposts.service.HidePasswordService;

class HidePasswordConsoleRouterTest {
    private final HidePasswordService hidePasswordService = new HidePasswordService();
    private WebTestClient authenticatedClient;
    private WebTestClient anonymousClient;

    @BeforeEach
    void setUp() {
        HidePasswordConsoleRouter router = new HidePasswordConsoleRouter(hidePasswordService);
        assertEquals("console.api.privateposts.halo.run", router.groupVersion().group());
        assertEquals("v1alpha1", router.groupVersion().version());

        anonymousClient = WebTestClient.bindToRouterFunction(router.endpoint()).build();

        var authentication = UsernamePasswordAuthenticationToken.authenticated(
            "author",
            "credentials",
            List.of(new SimpleGrantedAuthority("ROLE_USER"))
        );
        authenticatedClient = WebTestClient.bindToRouterFunction(router.endpoint())
            .webFilter((exchange, chain) -> chain.filter(exchange)
                .contextWrite(ReactiveSecurityContextHolder.withAuthentication(authentication)))
            .build();
    }

    @Test
    void returnsAConfigThatTheVerificationServiceAccepts() {
        authenticatedClient.post()
            .uri("/hide-password/hash")
            .bodyValue(Map.of("password", "正确密码"))
            .exchange()
            .expectStatus().isOk()
            .expectBody()
            .jsonPath("$.config")
            .value(config -> assertTrue(
                hidePasswordService.verify("正确密码", config.toString())
            ));
    }

    @Test
    void rejectsAnEmptyPassword() {
        authenticatedClient.post()
            .uri("/hide-password/hash")
            .bodyValue(Map.of("password", ""))
            .exchange()
            .expectStatus().isBadRequest()
            .expectBody()
            .jsonPath("$.message").isEqualTo("访问密码不能为空");
    }

    @Test
    void rejectsAnonymousRequests() {
        anonymousClient.post()
            .uri("/hide-password/hash")
            .bodyValue(Map.of("password", "secret"))
            .exchange()
            .expectStatus().isForbidden();
    }
}
