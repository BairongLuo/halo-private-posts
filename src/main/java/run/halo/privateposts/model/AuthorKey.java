package run.halo.privateposts.model;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
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
    kind = "AuthorKey",
    singular = "authorkey",
    plural = "authorkeys"
)
public class AuthorKey extends AbstractExtension {
    @Schema(requiredMode = REQUIRED)
    private AuthorKeySpec spec;

    @Data
    public static class AuthorKeySpec {
        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String ownerName;

        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String displayName;

        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String fingerprint;

        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String algorithm;

        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String publicKey;

        @Schema(requiredMode = REQUIRED, minLength = 1)
        private String createdAt;
    }
}
