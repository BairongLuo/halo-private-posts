package run.halo.privateposts.view;

import org.springframework.util.StringUtils;
import org.springframework.web.util.UriUtils;
import run.halo.app.core.extension.content.Post;
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

    public static PrivatePostView fromSourcePost(Post post, PrivatePost.Bundle bundle) {
        String postName = post.getMetadata() == null ? "" : nullToEmpty(post.getMetadata().getName());
        String slug = post.getSpec() == null ? readBundleSlug(bundle) : nullToEmpty(post.getSpec().getSlug());
        String encodedSlug = UriUtils.encode(slug, "UTF-8");
        return new PrivatePostView(
            postName,
            postName,
            slug,
            post.getSpec() == null ? readBundleTitle(bundle) : nullToEmpty(post.getSpec().getTitle()),
            readExcerpt(post, bundle),
            readPublishedAt(post, bundle),
            "/private-posts?slug=" + encodedSlug,
            "/private-posts/data?slug=" + encodedSlug,
            bundle
        );
    }

    private static String readExcerpt(Post post, PrivatePost.Bundle bundle) {
        if (post.getSpec() != null
            && post.getSpec().getExcerpt() != null
            && StringUtils.hasText(post.getSpec().getExcerpt().getRaw())) {
            return post.getSpec().getExcerpt().getRaw();
        }

        if (post.getStatus() != null && StringUtils.hasText(post.getStatus().getExcerpt())) {
            return post.getStatus().getExcerpt();
        }

        if (bundle != null && bundle.getMetadata() != null && StringUtils.hasText(bundle.getMetadata().getExcerpt())) {
            return bundle.getMetadata().getExcerpt();
        }

        return "";
    }

    private static String readPublishedAt(Post post, PrivatePost.Bundle bundle) {
        if (post.getSpec() != null && post.getSpec().getPublishTime() != null) {
            return post.getSpec().getPublishTime().toString();
        }

        if (bundle != null
            && bundle.getMetadata() != null
            && StringUtils.hasText(bundle.getMetadata().getPublishedAt())) {
            return bundle.getMetadata().getPublishedAt();
        }

        return "";
    }

    private static String readBundleSlug(PrivatePost.Bundle bundle) {
        if (bundle != null && bundle.getMetadata() != null) {
            return nullToEmpty(bundle.getMetadata().getSlug());
        }
        return "";
    }

    private static String readBundleTitle(PrivatePost.Bundle bundle) {
        if (bundle != null && bundle.getMetadata() != null) {
            return nullToEmpty(bundle.getMetadata().getTitle());
        }
        return "";
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
