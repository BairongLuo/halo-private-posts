package run.halo.privateposts.cleanup;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.util.StringUtils;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.ExtensionClient;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.MetadataOperator;
import run.halo.privateposts.service.PrivatePostService;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

public class PluginUninstallCleanupService {
    private static final Sort UNSORTED = Sort.unsorted();
    private static final Logger log = LoggerFactory.getLogger(PluginUninstallCleanupService.class);

    private final ExtensionClient client;
    private final PrivatePostService privatePostService;

    public PluginUninstallCleanupService(ExtensionClient client,
                                         PrivatePostService privatePostService) {
        this.client = client;
        this.privatePostService = privatePostService;
    }

    public CleanupSummary cleanup() {
        PostAnnotationCleanupResult postCleanup = clearPostBundleAnnotations();
        PrivatePostService.DeleteAllMappingsResult mappingCleanup = privatePostService
            .deleteAllMappingsBestEffort()
            .blockOptional()
            .orElseGet(() -> new PrivatePostService.DeleteAllMappingsResult(
                0,
                List.of("<delete-private-posts>")
            ));
        return new CleanupSummary(
            postCleanup.unlockedPosts(),
            mappingCleanup.deletedCount(),
            postCleanup.failedPostNames(),
            mappingCleanup.failedResourceNames()
        );
    }

    private PostAnnotationCleanupResult clearPostBundleAnnotations() {
        int updatedPosts = 0;
        List<String> failedPostNames = new ArrayList<>();
        try {
            for (Post post : client.listAll(Post.class, ListOptions.builder().build(), UNSORTED)) {
                if (!removeBundleAnnotation(post)) {
                    continue;
                }

                try {
                    client.update(post);
                    updatedPosts++;
                } catch (Exception error) {
                    String postName = postName(post);
                    failedPostNames.add(postName);
                    log.warn("Failed to remove private post bundle annotation from {} during uninstall cleanup.",
                        postName, error);
                }
            }
        } catch (Exception error) {
            failedPostNames.add("<list-posts>");
            log.warn("Failed to list posts during uninstall cleanup.", error);
        }
        return new PostAnnotationCleanupResult(updatedPosts, List.copyOf(failedPostNames));
    }

    private static boolean removeBundleAnnotation(Post post) {
        Metadata metadata = copyMetadata(post.getMetadata());
        if (metadata == null) {
            return false;
        }

        Map<String, String> annotations = metadata.getAnnotations();
        if (annotations == null
            || !annotations.containsKey(PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION)) {
            return false;
        }

        Map<String, String> mutableAnnotations = new LinkedHashMap<>(annotations);
        mutableAnnotations.remove(PostPrivatePostSyncListener.PRIVATE_POST_BUNDLE_ANNOTATION);
        metadata.setAnnotations(mutableAnnotations.isEmpty() ? null : mutableAnnotations);
        post.setMetadata(metadata);
        return true;
    }

    private static Metadata copyMetadata(MetadataOperator metadata) {
        if (metadata == null) {
            return null;
        }

        Metadata copied = new Metadata();
        copied.setName(metadata.getName());
        copied.setGenerateName(metadata.getGenerateName());
        copied.setLabels(copyMap(metadata.getLabels()));
        copied.setAnnotations(copyMap(metadata.getAnnotations()));
        copied.setVersion(metadata.getVersion());
        copied.setCreationTimestamp(metadata.getCreationTimestamp());
        copied.setDeletionTimestamp(metadata.getDeletionTimestamp());
        copied.setFinalizers(copySet(metadata.getFinalizers()));
        return copied;
    }

    private static Map<String, String> copyMap(Map<String, String> source) {
        return source == null ? null : new LinkedHashMap<>(source);
    }

    private static Set<String> copySet(Set<String> source) {
        return source == null ? null : new LinkedHashSet<>(source);
    }

    private static String postName(Post post) {
        if (post == null || post.getMetadata() == null
            || !StringUtils.hasText(post.getMetadata().getName())) {
            return "<unknown-post>";
        }
        return post.getMetadata().getName();
    }

    private record PostAnnotationCleanupResult(int unlockedPosts, List<String> failedPostNames) {
    }

    public record CleanupSummary(int unlockedPosts,
                                 int deletedPrivatePosts,
                                 List<String> failedPostNames,
                                 List<String> failedPrivatePostNames) {
        public boolean hasFailures() {
            return !failedPostNames.isEmpty() || !failedPrivatePostNames.isEmpty();
        }
    }
}
