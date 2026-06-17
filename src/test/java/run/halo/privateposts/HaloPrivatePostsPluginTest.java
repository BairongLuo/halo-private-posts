package run.halo.privateposts;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.plugin.PluginContext;
import run.halo.privateposts.cleanup.PluginUninstallCleanupService;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.service.PrivatePostService;

class HaloPrivatePostsPluginTest {
    @Test
    void stopShouldSkipUninstallCleanupAndUnregisterPrivatePostScheme() {
        PluginUninstallCleanupService cleanupService = mock(PluginUninstallCleanupService.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        SchemeManager schemeManager = mock(SchemeManager.class);
        Scheme scheme = mock(Scheme.class);
        when(privatePostService.cleanupStaleMappings()).thenReturn(Mono.just(0));
        when(schemeManager.get(PrivatePost.class)).thenReturn(scheme);
        HaloPrivatePostsPlugin plugin = new HaloPrivatePostsPlugin(
            new PluginContext("halo-private-posts", "config", "test-version", null),
            schemeManager,
            cleanupService,
            privatePostService
        );

        plugin.stop();

        verify(cleanupService, never()).cleanup();
        verify(schemeManager).unregister(scheme);
    }

    @Test
    void deleteShouldRunUninstallCleanup() {
        PluginUninstallCleanupService cleanupService = mock(PluginUninstallCleanupService.class);
        PrivatePostService privatePostService = mock(PrivatePostService.class);
        when(privatePostService.cleanupStaleMappings()).thenReturn(Mono.just(0));
        HaloPrivatePostsPlugin plugin = new HaloPrivatePostsPlugin(
            new PluginContext("halo-private-posts", "config", "test-version", null),
            mock(SchemeManager.class),
            cleanupService,
            privatePostService
        );
        when(cleanupService.cleanup())
            .thenReturn(new PluginUninstallCleanupService.CleanupSummary(
                1,
                2,
                java.util.List.of(),
                java.util.List.of()
            ));

        plugin.delete();

        verify(cleanupService).cleanup();
    }
}
