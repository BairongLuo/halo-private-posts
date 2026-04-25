package run.halo.privateposts.cleanup;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import run.halo.app.core.extension.content.Post;
import run.halo.app.extension.Extension;
import run.halo.app.extension.ExtensionClient;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.MetadataOperator;
import run.halo.privateposts.model.AuthorKey;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.sync.PostPrivatePostSyncListener;

@Service
public class PluginUninstallCleanupService {
    private static final Sort UNSORTED = Sort.unsorted();

    private final ExtensionClient client;

    public PluginUninstallCleanupService(ExtensionClient client) {
        this.client = client;
    }

    public CleanupSummary cleanup() {
        int unlockedPosts = clearPostBundleAnnotations();
        int deletedPrivatePosts = deleteAll(PrivatePost.class);
        int deletedAuthorKeys = deleteAll(AuthorKey.class);
        return new CleanupSummary(unlockedPosts, deletedPrivatePosts, deletedAuthorKeys);
    }

    private int clearPostBundleAnnotations() {
        int updatedPosts = 0;
        for (Post post : client.listAll(Post.class, ListOptions.builder().build(), UNSORTED)) {
            if (!removeBundleAnnotation(post)) {
                continue;
            }
            client.update(post);
            updatedPosts++;
        }
        return updatedPosts;
    }

    private <E extends Extension> int deleteAll(Class<E> type) {
        List<E> resources = client.listAll(type, ListOptions.builder().build(), UNSORTED);
        for (E resource : resources) {
            client.delete(resource);
        }
        return resources.size();
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

    public record CleanupSummary(int unlockedPosts, int deletedPrivatePosts, int deletedAuthorKeys) {
    }
}
