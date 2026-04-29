package run.halo.privateposts;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ExtensionClient;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.SchemeManager;
import run.halo.app.plugin.PluginContext;
import run.halo.privateposts.cleanup.PluginUninstallCleanupService;
import run.halo.privateposts.service.PrivatePostService;

class HaloPrivatePostsPluginTest {
    @Test
    void cleanupOnUninstallIfNeededShouldSkipNormalStop() {
        ExtensionClient extensionClient = mock(ExtensionClient.class);
        PluginUninstallCleanupService cleanupService = mock(PluginUninstallCleanupService.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        when(privatePostService.cleanupStaleMappings()).thenReturn(Mono.just(0));
        HaloPrivatePostsPlugin plugin = new HaloPrivatePostsPlugin(
            new PluginContext("halo-private-posts", "config", "test-version", null),
            mock(SchemeManager.class),
            extensionClient,
            cleanupService,
            privatePostService
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
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        when(privatePostService.cleanupStaleMappings()).thenReturn(Mono.just(0));
        HaloPrivatePostsPlugin plugin = new HaloPrivatePostsPlugin(
            new PluginContext("halo-private-posts", "config", "test-version", null),
            mock(SchemeManager.class),
            extensionClient,
            cleanupService,
            privatePostService
        );
        run.halo.app.core.extension.Plugin pluginResource = new run.halo.app.core.extension.Plugin();
        Metadata metadata = new Metadata();
        metadata.setName("halo-private-posts");
        metadata.setDeletionTimestamp(Instant.now());
        pluginResource.setMetadata(metadata);

        when(extensionClient.fetch(run.halo.app.core.extension.Plugin.class, "halo-private-posts"))
            .thenReturn(Optional.of(pluginResource));
        when(cleanupService.cleanup())
            .thenReturn(new PluginUninstallCleanupService.CleanupSummary(
                1,
                2,
                java.util.List.of(),
                java.util.List.of()
            ));

        plugin.cleanupOnUninstallIfNeeded();

        verify(cleanupService).cleanup();
    }
}
