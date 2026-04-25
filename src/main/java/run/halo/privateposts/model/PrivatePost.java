package run.halo.privateposts.model;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.ToString;
import run.halo.app.extension.AbstractExtension;
import run.halo.app.extension.GVK;

@Data
@ToString(callSuper = true)
@EqualsAndHashCode(callSuper = true)
@GVK(
    group = "privateposts.halo.run",
    version = "v1alpha1",
    kind = "PrivatePost",
    singular = "privatepost",
    plural = "privateposts"
)
public class PrivatePost extends AbstractExtension {
    @Schema(requiredMode = REQUIRED)
    private PrivatePostSpec spec;

    @Data
    public static class PrivatePostSpec {
        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String postName;

        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String slug;

        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String title;

        private String excerpt;

        private String publishedAt;

        @Schema(requiredMode = REQUIRED)
        private Bundle bundle;
    }

    @Data
    public static class Bundle {
        @Schema(requiredMode = REQUIRED)
        private Integer version;

        @Schema(requiredMode = REQUIRED)
        @JsonProperty("payload_format")
        private String payloadFormat;

        @Schema(requiredMode = REQUIRED)
        private String cipher;

        @Schema(requiredMode = REQUIRED)
        private String kdf;

        @Schema(requiredMode = REQUIRED)
        @JsonProperty("data_iv")
        private String dataIv;

        @Schema(requiredMode = REQUIRED)
        private String ciphertext;

        @Schema(requiredMode = REQUIRED)
        @JsonProperty("auth_tag")
        private String authTag;

        @Schema(requiredMode = REQUIRED)
        @JsonProperty("password_slot")
        private PasswordSlot passwordSlot;

        @JsonProperty("author_slots")
        private List<AuthorSlot> authorSlots;

        @Schema(requiredMode = REQUIRED)
        private BundleMetadata metadata;
    }

    @Data
    public static class PasswordSlot {
        @Schema(requiredMode = REQUIRED)
        private String kdf;

        @Schema(requiredMode = REQUIRED)
        private String salt;

        @Schema(requiredMode = REQUIRED)
        @JsonProperty("wrap_iv")
        private String wrapIv;

        @Schema(requiredMode = REQUIRED)
        @JsonProperty("wrapped_cek")
        private String wrappedCek;

        @Schema(requiredMode = REQUIRED)
        @JsonProperty("auth_tag")
        private String authTag;
    }

    @Data
    public static class AuthorSlot {
        @Schema(requiredMode = REQUIRED)
        @JsonProperty("key_id")
        private String keyId;

        @Schema(requiredMode = REQUIRED)
        private String algorithm;

        @Schema(requiredMode = REQUIRED)
        @JsonProperty("wrapped_cek")
        private String wrappedCek;
    }

    @Data
    public static class BundleMetadata {
        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String slug;

        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String title;

        private String excerpt;

        @JsonProperty("published_at")
        private String publishedAt;
    }
}
