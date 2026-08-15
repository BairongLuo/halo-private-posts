package run.halo.privateposts.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.function.IntFunction;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import run.halo.app.core.extension.content.Post;

/**
 * 内容隐藏的密码管理：密码以 PBKDF2 hash 形式存于文章注解，服务端负责生成与校验。
 *
 * <p>这是一个门禁（access gate），不是加密：正文仍然是 Halo 原生明文，插件只负责
 * 在渲染阶段把 {@code [hide-password]} 纯文本标记之间的内容替换成锁定块，
 * 读者输入密码通过服务端校验后才把内容返回。
 */
@Service
public class HidePasswordService {
    public static final String HIDE_PASSWORD_ANNOTATION = "privateposts.halo.run/hide-password";

    public static final String HIDE_START = "[hide-password]";
    public static final String HIDE_END = "[/hide-password]";

    private static final String PBKDF2_ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final int PBKDF2_ITERATIONS = 210_000;
    private static final int PBKDF2_KEY_BITS = 256;
    private static final int SALT_BYTES = 16;
    private static final int CONFIG_VERSION = 1;
    public static final int MAX_PASSWORD_LENGTH = 256;
    private static final String CONFIG_ALGORITHM = PBKDF2_ALGORITHM.toLowerCase(Locale.ROOT);

    private static final Pattern HIDE_BLOCK_CAPTURE = Pattern.compile(
        "<p[^>]*>(?:(?!</p>)[\\s\\S])*?\\[hide-password](?:(?!</p>)[\\s\\S])*?</p>"
            + "([\\s\\S]*?)"
            + "<p[^>]*>(?:(?!</p>)[\\s\\S])*?\\[/hide-password](?:(?!</p>)[\\s\\S])*?</p>",
        Pattern.CASE_INSENSITIVE
    );

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private final SecureRandom secureRandom = new SecureRandom();

    /**
     * 读文章注解里的密码配置 JSON，未设置返回 null。
     */
    public String readPasswordConfig(Post post) {
        if (post == null || post.getMetadata() == null
            || post.getMetadata().getAnnotations() == null) {
            return null;
        }
        String config = post.getMetadata().getAnnotations().get(HIDE_PASSWORD_ANNOTATION);
        return StringUtils.hasText(config) ? config.trim() : null;
    }

    public boolean isConfigured(Post post) {
        return readPasswordConfig(post) != null;
    }

    /**
     * 根据明文密码生成密码配置 JSON，用于写入文章注解。
     */
    public String buildPasswordConfig(String password) {
        if (!StringUtils.hasText(password)) {
            throw new IllegalArgumentException("访问密码不能为空");
        }
        if (password.length() > MAX_PASSWORD_LENGTH) {
            throw new IllegalArgumentException("访问密码不能超过 " + MAX_PASSWORD_LENGTH + " 个字符");
        }

        byte[] salt = new byte[SALT_BYTES];
        secureRandom.nextBytes(salt);
        byte[] hash = pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BITS);

        Map<String, Object> config = new LinkedHashMap<>();
        config.put("version", CONFIG_VERSION);
        config.put("algorithm", CONFIG_ALGORITHM);
        config.put("iterations", PBKDF2_ITERATIONS);
        config.put("salt", bytesToHex(salt));
        config.put("hash", bytesToHex(hash));

        try {
            return OBJECT_MAPPER.writeValueAsString(config);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("生成密码配置失败", exception);
        }
    }

    /**
     * 校验密码是否匹配配置 JSON。配置非法时返回 false。
     */
    public boolean verify(String password, String configJson) {
        if (!StringUtils.hasText(password) || password.length() > MAX_PASSWORD_LENGTH
            || !StringUtils.hasText(configJson)) {
            return false;
        }

        try {
            Map<?, ?> config = OBJECT_MAPPER.readValue(configJson, Map.class);
            Object versionValue = config.get("version");
            Object algorithmValue = config.get("algorithm");
            Object saltValue = config.get("salt");
            Object hashValue = config.get("hash");
            Object iterationsValue = config.get("iterations");
            if (!(versionValue instanceof Number versionNumber)
                || versionNumber.intValue() != CONFIG_VERSION
                || !(algorithmValue instanceof String algorithmText)
                || !CONFIG_ALGORITHM.equals(algorithmText.toLowerCase(Locale.ROOT))
                || !(saltValue instanceof String saltText)
                || !(hashValue instanceof String hashText)
                || !(iterationsValue instanceof Number iterationsNumber)) {
                return false;
            }

            int iterations = iterationsNumber.intValue();
            if (iterations != PBKDF2_ITERATIONS) {
                return false;
            }

            byte[] salt = hexToBytes(saltText);
            byte[] expected = hexToBytes(hashText);
            if (salt.length != SALT_BYTES || expected.length != PBKDF2_KEY_BITS / 8) {
                return false;
            }
            byte[] actual = pbkdf2(password, salt, iterations, expected.length * 8);
            return MessageDigest.isEqual(expected, actual);
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            return false;
        }
    }

    /**
     * 从渲染后的正文 HTML 里解析所有 hide-password 段的内容（返回 HTML 片段）。
     */
    public List<String> parseHiddenSegments(String html) {
        List<String> segments = new ArrayList<>();
        if (html == null) {
            return segments;
        }

        Matcher matcher = HIDE_BLOCK_CAPTURE.matcher(html);
        while (matcher.find()) {
            segments.add(matcher.group(1));
        }
        return segments;
    }

    public boolean hasHiddenSegment(String html) {
        return html != null && HIDE_BLOCK_CAPTURE.matcher(html).find();
    }

    /**
     * 用按序号生成的占位 HTML 替换所有隐藏片段。与解锁时的片段解析共用
     * 同一个边界正则，避免渲染端和校验端对片段数量的理解不一致。
     */
    public String replaceHiddenSegments(String html, IntFunction<String> replacementFactory) {
        if (html == null) {
            return null;
        }
        Objects.requireNonNull(replacementFactory, "replacementFactory must not be null");

        Matcher matcher = HIDE_BLOCK_CAPTURE.matcher(html);
        StringBuffer buffer = new StringBuffer();
        int index = 0;
        while (matcher.find()) {
            String replacement = Objects.requireNonNull(
                replacementFactory.apply(index++),
                "replacement must not be null"
            );
            matcher.appendReplacement(buffer, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(buffer);
        return buffer.toString();
    }

    private byte[] pbkdf2(String password, byte[] salt, int iterations, int keyBits) {
        PBEKeySpec spec = new PBEKeySpec(
            password.toCharArray(),
            salt,
            iterations,
            keyBits
        );
        try {
            return SecretKeyFactory.getInstance(PBKDF2_ALGORITHM).generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("PBKDF2 派生失败", exception);
        } finally {
            spec.clearPassword();
        }
    }

    private static String bytesToHex(byte[] value) {
        StringBuilder builder = new StringBuilder(value.length * 2);
        for (byte current : value) {
            builder.append(String.format("%02x", current & 0xff));
        }
        return builder.toString();
    }

    private static byte[] hexToBytes(String value) {
        String hex = value == null ? "" : value.trim();
        if (hex.isEmpty() || (hex.length() % 2) != 0) {
            throw new IllegalArgumentException("非法 hex 内容");
        }

        byte[] result = new byte[hex.length() / 2];
        for (int index = 0; index < hex.length(); index += 2) {
            result[index / 2] = (byte) Integer.parseInt(hex.substring(index, index + 2), 16);
        }
        return result;
    }
}
