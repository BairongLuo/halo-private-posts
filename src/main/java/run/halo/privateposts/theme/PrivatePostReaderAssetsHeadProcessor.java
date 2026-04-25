package run.halo.privateposts.theme;

import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.thymeleaf.context.ITemplateContext;
import org.thymeleaf.model.AttributeValueQuotes;
import org.thymeleaf.model.IModel;
import org.thymeleaf.model.IModelFactory;
import org.thymeleaf.model.IProcessableElementTag;
import org.thymeleaf.model.ITemplateEvent;
import org.thymeleaf.processor.element.IElementModelStructureHandler;
import reactor.core.publisher.Mono;
import run.halo.app.theme.dialect.TemplateHeadProcessor;

@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class PrivatePostReaderAssetsHeadProcessor implements TemplateHeadProcessor {
    private static final String READER_STYLESHEET_PATH =
        "/plugins/halo-private-posts/assets/reader/reader.css";
    private static final String READER_SCRIPT_PATH =
        "/plugins/halo-private-posts/assets/reader/reader.js";
    private static final String STYLE_MARKER = "data-halo-private-post-reader-style";
    private static final String SCRIPT_MARKER = "data-halo-private-post-reader-script";

    @Override
    public Mono<Void> process(ITemplateContext context,
                              IModel model,
                              IElementModelStructureHandler structureHandler) {
        IModelFactory modelFactory = context.getModelFactory();
        String assetVersion = PrivatePostAssetVersion.current();
        String stylesheetUrl = versionedUrl(READER_STYLESHEET_PATH, assetVersion);
        String scriptUrl = versionedUrl(READER_SCRIPT_PATH, assetVersion);

        if (!containsAttribute(model, STYLE_MARKER)) {
            model.insert(
                Math.max(model.size() - 1, 0),
                modelFactory.createStandaloneElementTag(
                    "link",
                    Map.of(
                        "rel", "stylesheet",
                        "href", stylesheetUrl,
                        STYLE_MARKER, "global"
                    ),
                    AttributeValueQuotes.DOUBLE,
                    false,
                    true
                )
            );
        }

        if (!containsAttribute(model, SCRIPT_MARKER)) {
            int insertIndex = Math.max(model.size() - 1, 0);
            model.insert(
                insertIndex++,
                modelFactory.createOpenElementTag(
                    "script",
                    Map.of(
                        "src", scriptUrl,
                        "defer", "defer",
                        SCRIPT_MARKER, "global"
                    ),
                    AttributeValueQuotes.DOUBLE,
                    false
                )
            );
            model.insert(insertIndex, modelFactory.createCloseElementTag("script"));
        }

        return Mono.empty();
    }

    private static String versionedUrl(String path, String assetVersion) {
        return path + "?version=" + assetVersion;
    }

    private static boolean containsAttribute(IModel model, String attributeName) {
        for (int i = 0; i < model.size(); i++) {
            ITemplateEvent event = model.get(i);
            if (event instanceof IProcessableElementTag tag && tag.hasAttribute(attributeName)) {
                return true;
            }
        }
        return false;
    }
}
