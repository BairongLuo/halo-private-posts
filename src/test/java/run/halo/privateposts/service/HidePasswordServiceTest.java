package run.halo.privateposts.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class HidePasswordServiceTest {
    private final HidePasswordService service = new HidePasswordService();

    @Test
    void passwordRoundTrip() {
        String config = service.buildPasswordConfig("正确的密码123");
        assertNotNull(config);
        assertTrue(service.verify("正确的密码123", config), "正确密码应校验通过");
        assertFalse(service.verify("错误密码", config), "错误密码应校验失败");
    }

    @Test
    void passwordRoundTripRepeatedly() {
        for (int i = 0; i < 100; i++) {
            String password = "pw-" + i;
            String config = service.buildPasswordConfig(password);
            assertTrue(service.verify(password, config), "第 " + i + " 次往返校验失败");
        }
    }

    @Test
    void parseHiddenSegmentsFromRenderedHtml() {
        String html = "<p>[hide-password]</p><p>秘密内容</p><p>[/hide-password]</p>";
        List<String> segments = service.parseHiddenSegments(html);
        assertEquals(1, segments.size());
        assertEquals("<p>秘密内容</p>", segments.get(0));
    }

    @Test
    void parsesAndReplacesMultipleSegmentsWithoutTouchingPublicContent() {
        String html = "<p>公开 A</p>"
            + "<p>[hide-password]</p><p>秘密 A</p><p>[/hide-password]</p>"
            + "<p>公开 B</p>"
            + "<p>[hide-password]</p><p>秘密 B</p><p>[/hide-password]</p>"
            + "<p>公开 C</p>";

        assertEquals(List.of("<p>秘密 A</p>", "<p>秘密 B</p>"), service.parseHiddenSegments(html));
        assertEquals(
            "<p>公开 A</p><locked data-index=\"0\"></locked><p>公开 B</p>"
                + "<locked data-index=\"1\"></locked><p>公开 C</p>",
            service.replaceHiddenSegments(
                html,
                index -> "<locked data-index=\"" + index + "\"></locked>"
            )
        );
    }

    @Test
    void rejectsMalformedOrUnsupportedPasswordConfigs() {
        String config = service.buildPasswordConfig("正确密码");

        assertFalse(service.verify("正确密码", config.replace("\"version\":1", "\"version\":2")));
        assertFalse(service.verify("正确密码", config.replace("\"iterations\":210000", "\"iterations\":1")));
        assertFalse(service.verify("正确密码", "not-json"));
        assertFalse(service.verify("正确密码", null));
    }

    @Test
    void enforcesPasswordLengthLimit() {
        String oversized = "x".repeat(HidePasswordService.MAX_PASSWORD_LENGTH + 1);

        assertThrows(IllegalArgumentException.class, () -> service.buildPasswordConfig(oversized));
        assertFalse(service.verify(oversized, service.buildPasswordConfig("正常密码")));
    }

}
