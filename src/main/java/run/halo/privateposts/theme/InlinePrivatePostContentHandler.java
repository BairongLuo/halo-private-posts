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

@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InlinePrivatePostContentHandler implements ReactivePostContentHandler {
    private static final int IDLE_TIMEOUT_MS = 300000;

    private final PrivatePostService privatePostService;

    public InlinePrivatePostContentHandler(PrivatePostService privatePostService) {
        this.privatePostService = privatePostService;
    }

    @Override
    public Mono<PostContentContext> handle(@NonNull PostContentContext postContent) {
        Post post = postContent.getPost();
        if (!PrivatePostService.isActivePrivatePostSource(post) || post.getMetadata() == null) {
            return Mono.just(postContent);
        }

        String postName = post.getMetadata().getName();
        if (!StringUtils.hasText(postName)) {
            return Mono.just(postContent);
        }

        return privatePostService.getByPostName(postName)
            .map(privatePost -> {
                postContent.setContent(buildInlineReaderHtml(privatePost));
                return postContent;
            })
            .switchIfEmpty(Mono.just(postContent));
    }

    private String buildInlineReaderHtml(PrivatePost privatePost) {
        String slug = privatePost.getSpec().getSlug();
        String encodedSlug = UriUtils.encode(slug, "UTF-8");
        String excerpt = StringUtils.hasText(privatePost.getSpec().getExcerpt())
            ? """
                <p class="hpp-excerpt">%s</p>
                """.formatted(escape(privatePost.getSpec().getExcerpt()))
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
                    <p class="hpp-hint">
                      正文解锁后会在离开页面、切后台或空闲超时后自动重新锁定。
                      <a class="hpp-link" href="%s">独立阅读页</a>
                    </p>
                  </div>
                  <article class="hpp-content" data-hpp-content hidden></article>
                </div>
              </div>
              <noscript>
                <p>
                  此页面需要 JavaScript 才能在当前页面中本地解密正文。
                  <a class="hpp-link" href="%s">打开独立阅读页</a>
                </p>
              </noscript>
            </section>
            """.formatted(
            escape("/private-posts/data?slug=" + encodedSlug),
            IDLE_TIMEOUT_MS,
            excerpt,
            escape(privatePost.getMetadata().getName()),
            escape(privatePost.getMetadata().getName()),
            escape("/private-posts?slug=" + encodedSlug),
            escape("/private-posts?slug=" + encodedSlug)
        );
    }

    private static String escape(String value) {
        return HtmlUtils.htmlEscape(value);
    }
}
