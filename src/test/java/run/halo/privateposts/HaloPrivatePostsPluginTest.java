package run.halo.privateposts;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import run.halo.app.extension.ExtensionClient;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.SchemeManager;
import run.halo.app.plugin.PluginContext;
import run.halo.privateposts.cleanup.PluginUninstallCleanupService;

class HaloPrivatePostsPluginTest {
    @Test
    void cleanupOnUninstallIfNeededShouldSkipNormalStop() {
        ExtensionClient extensionClient = mock(ExtensionClient.class);
        PluginUninstallCleanupService cleanupService = mock(PluginUninstallCleanupService.class);
        HaloPrivatePostsPlugin plugin = new HaloPrivatePostsPlugin(
            new PluginContext("halo-private-posts", "config", "0.5.5", null),
            mock(SchemeManager.class),
            extensionClient,
            cleanupService
        );
        run.halo.app.core.extension.Plugin pluginResource = new run.halo.app.core.extension.Plugin();
        Metadata metadata = new Metadata();
        metadata.setName("halo-private-posts");
        pluginResource.setMetadata(metadata);

        when(extensionClient.fetch(run.halo.app.core.extension.Plugin.class, "halo-private-posts"))
            .thenReturn(Optional.of(pluginResource));

        plugin.cleanupOnUninstallIfNeeded();

        verify(cleanupService, never()).cleanup();
    }

    @Test
    void cleanupOnUninstallIfNeededShouldRunForDeletingPlugin() {
        ExtensionClient extensionClient = mock(ExtensionClient.class);
        PluginUninstallCleanupService cleanupService = mock(PluginUninstallCleanupService.class);
        HaloPrivatePostsPlugin plugin = new HaloPrivatePostsPlugin(
            new PluginContext("halo-private-posts", "config", "0.5.5", null),
            mock(SchemeManager.class),
            extensionClient,
            cleanupService
        );
        run.halo.app.core.extension.Plugin pluginResource = new run.halo.app.core.extension.Plugin();
        Metadata metadata = new Metadata();
        metadata.setName("halo-private-posts");
        metadata.setDeletionTimestamp(Instant.now());
        pluginResource.setMetadata(metadata);

        when(extensionClient.fetch(run.halo.app.core.extension.Plugin.class, "halo-private-posts"))
            .thenReturn(Optional.of(pluginResource));
        when(cleanupService.cleanup())
            .thenReturn(new PluginUninstallCleanupService.CleanupSummary(1, 2, 3));

        plugin.cleanupOnUninstallIfNeeded();

        verify(cleanupService).cleanup();
    }
}
