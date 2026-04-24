package run.halo.privateposts;

import static run.halo.app.extension.index.IndexAttributeFactory.simpleAttribute;

import java.util.function.Function;
import org.springframework.stereotype.Component;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.extension.index.IndexSpec;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;
import run.halo.privateposts.model.PrivatePost;

@Component
public class HaloPrivatePostsPlugin extends BasePlugin {
    private final SchemeManager schemeManager;

    public HaloPrivatePostsPlugin(PluginContext pluginContext, SchemeManager schemeManager) {
        super(pluginContext);
        this.schemeManager = schemeManager;
    }

    @Override
    public void start() {
        schemeManager.register(PrivatePost.class, indexSpecs -> {
            indexSpecs.add(new IndexSpec()
                .setName("spec.slug")
                .setUnique(true)
                .setIndexFunc(simpleAttribute(PrivatePost.class,
                    privatePost -> specValue(privatePost, PrivatePost.PrivatePostSpec::getSlug))));
            indexSpecs.add(new IndexSpec()
                .setName("spec.postName")
                .setUnique(true)
                .setIndexFunc(simpleAttribute(PrivatePost.class,
                    privatePost -> specValue(privatePost, PrivatePost.PrivatePostSpec::getPostName))));
            indexSpecs.add(new IndexSpec()
                .setName("spec.publishedAt")
                .setIndexFunc(simpleAttribute(PrivatePost.class,
                    privatePost -> specValue(privatePost,
                        PrivatePost.PrivatePostSpec::getPublishedAt))));
        });
    }

    @Override
    public void stop() {
        Scheme scheme = schemeManager.get(PrivatePost.class);
        if (scheme != null) {
            schemeManager.unregister(scheme);
        }
    }

    private static String specValue(PrivatePost privatePost,
                                    Function<PrivatePost.PrivatePostSpec, String> extractor) {
        if (privatePost == null || privatePost.getSpec() == null) {
            return null;
        }
        return extractor.apply(privatePost.getSpec());
    }
}
