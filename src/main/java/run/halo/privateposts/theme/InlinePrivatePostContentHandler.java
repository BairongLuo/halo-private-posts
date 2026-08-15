package run.halo.privateposts.theme;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.theme.ReactivePostContentHandler;
import run.halo.privateposts.service.HidePasswordService;

/**
 * 渲染拦截：把正文里的 {@code [hide-password]} 纯文本标记之间的内容替换成锁定块。
 *
 * <p>拦截发生在编辑器渲染之后，因此这里操作的是渲染后的 HTML。被标记包住的内容会被
 * 替换成锁定块，不再下发给读者；读者输入密码通过服务端校验后，内容才被返回。
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InlinePrivatePostContentHandler implements ReactivePostContentHandler {
    private static final String VERIFY_PATH =
        "/apis/api.privateposts.halo.run/v1alpha1/hide-password/verify";

    private final HidePasswordService hidePasswordService;

    public InlinePrivatePostContentHandler(HidePasswordService hidePasswordService) {
        this.hidePasswordService = hidePasswordService;
    }

    @Override
    public Mono<PostContentContext> handle(PostContentContext postContent) {
        Post post = postContent.getPost();
        if (!hidePasswordService.isConfigured(post)) {
            return Mono.just(postContent);
        }

        String postName = post.getMetadata() == null ? null : post.getMetadata().getName();
        if (!StringUtils.hasText(postName)) {
            return Mono.just(postContent);
        }

        String html = postContent.getContent();
        if (!StringUtils.hasText(html)) {
            return Mono.just(postContent);
        }

        postContent.setContent(hidePasswordService.replaceHiddenSegments(
            html,
            index -> buildLockHtml(postName, index)
        ));
        return Mono.just(postContent);
    }

    private String buildLockHtml(String postName, int index) {
        String escapedPostName = HtmlUtils.htmlEscape(postName);
        return """
            <section
              class="hpp-inline"
              data-halo-private-post-hide="true"
              data-hide-post="%s"
              data-hide-index="%d"
              data-hide-verify-url="%s"
            >
              <div class="hpp-shell">
                <div class="hpp-panel">
                  <div class="hpp-lock" data-hpp-lock-panel>
                    <p class="hpp-status" data-hpp-status data-status="neutral" hidden></p>
                    <form class="hpp-form hpp-form--inline" data-hpp-form>
                      <input
                        class="hpp-input"
                        data-hpp-password
                        type="password"
                        placeholder="访问密码"
                        autocomplete="current-password"
                        maxlength="%d"
                      >
                      <button class="hpp-button" data-hpp-submit type="submit">
                        解锁
                      </button>
                    </form>
                  </div>
                  <div class="hpp-content" data-hpp-content hidden></div>
                </div>
              </div>
              <noscript>
                <p>此内容需要输入密码查看。</p>
              </noscript>
            </section>
            """.formatted(
                escapedPostName,
                index,
                VERIFY_PATH,
                HidePasswordService.MAX_PASSWORD_LENGTH
            );
    }
}
