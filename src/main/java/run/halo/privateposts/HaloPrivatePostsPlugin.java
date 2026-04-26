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
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.service.PrivatePostService;

@Component
public class HaloPrivatePostsPlugin extends BasePlugin {
    private static final Logger log = LoggerFactory.getLogger(HaloPrivatePostsPlugin.class);

    private final SchemeManager schemeManager;
    private final ExtensionClient extensionClient;
    private final PluginUninstallCleanupService cleanupService;
    private final PrivatePostService privatePostService;

    public HaloPrivatePostsPlugin(PluginContext pluginContext,
                                  SchemeManager schemeManager,
                                  ExtensionClient extensionClient,
                                  PluginUninstallCleanupService cleanupService,
                                  PrivatePostService privatePostService) {
        super(pluginContext);
        this.schemeManager = schemeManager;
        this.extensionClient = extensionClient;
        this.cleanupService = cleanupService;
        this.privatePostService = privatePostService;
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

        privatePostService.cleanupStaleMappings()
            .doOnNext(deletedCount -> {
                if (deletedCount > 0) {
                    log.info("Removed {} stale private post mappings on plugin startup.", deletedCount);
                }
            })
            .doOnError(error -> log.warn("Failed to cleanup stale private post mappings on startup.", error))
            .subscribe();
    }

    @Override
    public void stop() {
        cleanupOnUninstallIfNeeded();

        Scheme scheme = schemeManager.get(PrivatePost.class);
        if (scheme != null) {
            schemeManager.unregister(scheme);
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
                "Completed uninstall cleanup for plugin {}. Unlocked {} posts, deleted {} private posts.",
                getContext().getName(),
                summary.unlockedPosts(),
                summary.deletedPrivatePosts()
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
}
