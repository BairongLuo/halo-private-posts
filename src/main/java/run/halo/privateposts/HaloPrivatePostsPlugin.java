package run.halo.privateposts;

import java.util.Optional;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import run.halo.app.extension.ExtensionClient;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.extension.index.IndexSpecs;
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

    @Autowired
    public HaloPrivatePostsPlugin(PluginContext pluginContext,
                                  SchemeManager schemeManager,
                                  ExtensionClient extensionClient,
                                  PrivatePostService privatePostService) {
        this(
            pluginContext,
            schemeManager,
            extensionClient,
            new PluginUninstallCleanupService(extensionClient, privatePostService),
            privatePostService
        );
    }

    HaloPrivatePostsPlugin(PluginContext pluginContext,
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
            indexSpecs.add(IndexSpecs.<PrivatePost, String>single("spec.slug", String.class)
                .unique(true)
                .indexFunc(privatePost -> specValue(privatePost,
                    PrivatePost.PrivatePostSpec::getSlug)));
            indexSpecs.add(IndexSpecs.<PrivatePost, String>single("spec.postName", String.class)
                .unique(true)
                .indexFunc(privatePost -> specValue(privatePost,
                    PrivatePost.PrivatePostSpec::getPostName)));
            indexSpecs.add(IndexSpecs.<PrivatePost, String>single("spec.publishedAt", String.class)
                .indexFunc(privatePost -> specValue(privatePost,
                    PrivatePost.PrivatePostSpec::getPublishedAt)));
        });

        privatePostService.cleanupStaleMappings()
            .flatMap(deletedCount -> privatePostService.reconcileMappings()
                .map(reconciledCount -> new StartupSummary(deletedCount, reconciledCount)))
            .doOnNext(summary -> {
                if (summary.deletedMappings() > 0 || summary.reconciledMappings() > 0) {
                    log.info(
                        "Plugin startup reconciliation removed {} stale private post mappings and"
                            + " rebuilt {} mappings.",
                        summary.deletedMappings(),
                        summary.reconciledMappings()
                    );
                }
            })
            .doOnError(error -> log.warn("Failed private post startup reconciliation.", error))
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
            if (summary.hasFailures()) {
                log.warn(
                    "Completed uninstall cleanup for plugin {} with failures. Unlocked {} posts,"
                        + " deleted {} private posts, failed posts {}, failed private posts {}.",
                    getContext().getName(),
                    summary.unlockedPosts(),
                    summary.deletedPrivatePosts(),
                    summary.failedPostNames(),
                    summary.failedPrivatePostNames()
                );
            } else {
                log.info(
                    "Completed uninstall cleanup for plugin {}. Unlocked {} posts, deleted {}"
                        + " private posts.",
                    getContext().getName(),
                    summary.unlockedPosts(),
                    summary.deletedPrivatePosts()
                );
            }
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

    private record StartupSummary(int deletedMappings, int reconciledMappings) {
    }
}
