package run.halo.privateposts.view;

import org.springframework.web.util.UriUtils;
import run.halo.privateposts.model.PrivatePost;

public record PrivatePostView(
    String resourceName,
    String postName,
    String slug,
    String title,
    String excerpt,
    String publishedAt,
    String readerUrl,
    String bundleUrl,
    PrivatePost.Bundle bundle
) {
    public static PrivatePostView from(PrivatePost privatePost) {
        String slug = privatePost.getSpec().getSlug();
        String encodedSlug = UriUtils.encode(slug, "UTF-8");
        return new PrivatePostView(
            privatePost.getMetadata().getName(),
            privatePost.getSpec().getPostName(),
            slug,
            privatePost.getSpec().getTitle(),
            nullToEmpty(privatePost.getSpec().getExcerpt()),
            nullToEmpty(privatePost.getSpec().getPublishedAt()),
            "/private-posts?slug=" + encodedSlug,
            "/private-posts/data?slug=" + encodedSlug,
            privatePost.getSpec().getBundle()
        );
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
