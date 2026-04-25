package run.halo.privateposts;

import static run.halo.app.extension.index.IndexAttributeFactory.simpleAttribute;

import java.util.Optional;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import run.halo.app.extension.ExtensionClient;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.extension.index.IndexSpec;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;
import run.halo.privateposts.cleanup.PluginUninstallCleanupService;
import run.halo.privateposts.model.AuthorKey;
import run.halo.privateposts.model.PrivatePost;

@Component
public class HaloPrivatePostsPlugin extends BasePlugin {
    private static final Logger log = LoggerFactory.getLogger(HaloPrivatePostsPlugin.class);

    private final SchemeManager schemeManager;
    private final ExtensionClient extensionClient;
    private final PluginUninstallCleanupService cleanupService;

    public HaloPrivatePostsPlugin(PluginContext pluginContext,
                                  SchemeManager schemeManager,
                                  ExtensionClient extensionClient,
                                  PluginUninstallCleanupService cleanupService) {
        super(pluginContext);
        this.schemeManager = schemeManager;
        this.extensionClient = extensionClient;
        this.cleanupService = cleanupService;
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
        schemeManager.register(AuthorKey.class, indexSpecs -> {
            indexSpecs.add(new IndexSpec()
                .setName("spec.fingerprint")
                .setUnique(true)
                .setIndexFunc(simpleAttribute(AuthorKey.class,
                    authorKey -> authorKeySpecValue(authorKey,
                        AuthorKey.AuthorKeySpec::getFingerprint))));
            indexSpecs.add(new IndexSpec()
                .setName("spec.ownerName")
                .setIndexFunc(simpleAttribute(AuthorKey.class,
                    authorKey -> authorKeySpecValue(authorKey,
                        AuthorKey.AuthorKeySpec::getOwnerName))));
        });
    }

    @Override
    public void stop() {
        cleanupOnUninstallIfNeeded();

        Scheme scheme = schemeManager.get(PrivatePost.class);
        if (scheme != null) {
            schemeManager.unregister(scheme);
        }

        Scheme authorKeyScheme = schemeManager.get(AuthorKey.class);
        if (authorKeyScheme != null) {
            schemeManager.unregister(authorKeyScheme);
        }
    }

    void cleanupOnUninstallIfNeeded() {
        try {
            Optional<run.halo.app.core.extension.Plugin> plugin = extensionClient.fetch(
                run.halo.app.core.extension.Plugin.class,
                getContext().getName()
            );
            if (plugin.isEmpty()
                || plugin.get().getMetadata() == null
                || plugin.get().getMetadata().getDeletionTimestamp() == null) {
                return;
            }

            PluginUninstallCleanupService.CleanupSummary summary = cleanupService.cleanup();
            log.info(
                "Completed uninstall cleanup for plugin {}. Unlocked {} posts, deleted {} private posts, deleted {} author keys.",
                getContext().getName(),
                summary.unlockedPosts(),
                summary.deletedPrivatePosts(),
                summary.deletedAuthorKeys()
            );
        } catch (Exception error) {
            log.warn("Failed uninstall cleanup for plugin {} during stop().", getContext().getName(), error);
        }
    }

    private static String specValue(PrivatePost privatePost,
                                    Function<PrivatePost.PrivatePostSpec, String> extractor) {
        if (privatePost == null || privatePost.getSpec() == null) {
            return null;
        }
        return extractor.apply(privatePost.getSpec());
    }

    private static String authorKeySpecValue(AuthorKey authorKey,
                                             Function<AuthorKey.AuthorKeySpec, String> extractor) {
        if (authorKey == null || authorKey.getSpec() == null) {
            return null;
        }
        return extractor.apply(authorKey.getSpec());
    }
}
