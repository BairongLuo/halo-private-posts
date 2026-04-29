package run.halo.privateposts.theme;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;
import org.springframework.web.util.UriUtils;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.theme.ReactivePostContentHandler;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InlinePrivatePostContentHandler implements ReactivePostContentHandler {
    private static final int IDLE_TIMEOUT_MS = 300000;

    @Override
    public Mono<PostContentContext> handle(@NonNull PostContentContext postContent) {
        Post post = postContent.getPost();
        if (!PrivatePostService.isActivePrivatePostSource(post)
            || post.getMetadata() == null
            || post.getSpec() == null
            || !StringUtils.hasText(post.getSpec().getSlug())) {
            return Mono.just(postContent);
        }

        String postName = post.getMetadata().getName();
        if (!StringUtils.hasText(postName)) {
            return Mono.just(postContent);
        }

        PrivatePost.Bundle bundle = PostPrivatePostSyncListener.readBundleFromAnnotations(
            postName,
            post.getMetadata().getAnnotations()
        );
        if (bundle == null) {
            return Mono.just(postContent);
        }

        postContent.setContent(buildInlineReaderHtml(post, bundle));
        return Mono.just(postContent);
    }

    private String buildInlineReaderHtml(Post post, PrivatePost.Bundle bundle) {
        String slug = post.getSpec().getSlug();
        String encodedSlug = UriUtils.encode(slug, "UTF-8");
        String excerpt = readExcerpt(post, bundle);
        String postName = post.getMetadata() == null ? "" : post.getMetadata().getName();
        String safeExcerpt = StringUtils.hasText(excerpt)
            ? """
                <p class="hpp-excerpt">%s</p>
                """.formatted(escape(excerpt))
            : "";

        return """
            <section
              class="hpp-inline"
              data-halo-private-post-reader="true"
              data-hpp-layout="inline"
              data-bundle-url="%s"
              data-idle-timeout-ms="%d"
            >
              <div class="hpp-shell">
                <div class="hpp-panel">
                  <div class="hpp-lock" data-hpp-lock-panel>
                    %s
                    <p class="hpp-status" data-hpp-status data-status="neutral">
                      这篇文章的正文已加密托管。输入访问密码后，正文会在浏览器本地解密。
                    </p>
                    <form class="hpp-form" data-hpp-form>
                      <label class="hpp-label" for="hpp-password-%s">
                        访问密码
                        <input
                          class="hpp-input"
                          id="hpp-password-%s"
                          data-hpp-password
                          type="password"
                          autocomplete="current-password"
                        >
                      </label>
                      <div class="hpp-actions">
                        <button class="hpp-button" data-hpp-submit type="submit">
                          用密码解锁
                        </button>
                      </div>
                    </form>
                  </div>
                  <article class="hpp-content" data-hpp-content hidden></article>
                </div>
              </div>
              <noscript>
                <p>
                  此页面需要 JavaScript 才能在当前页面中本地解密正文。
                </p>
              </noscript>
            </section>
            """.formatted(
            escape("/private-posts/data?slug=" + encodedSlug),
            IDLE_TIMEOUT_MS,
            safeExcerpt,
            escape(postName),
            escape(postName)
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

    private static String escape(String value) {
        return HtmlUtils.htmlEscape(value);
    }
}
