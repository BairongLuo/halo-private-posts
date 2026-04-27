package run.halo.privateposts.sync;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.event.post.PostDeletedEvent;
import run.halo.app.event.post.PostPublishedEvent;
import run.halo.app.event.post.PostUnpublishedEvent;
import run.halo.app.event.post.PostUpdatedEvent;
import run.halo.app.event.post.PostVisibleChangedEvent;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.privateposts.model.PrivatePost;
import run.halo.privateposts.service.PrivatePostService;

@Component
public class PostPrivatePostSyncListener {
    public static final String PRIVATE_POST_BUNDLE_ANNOTATION = "privateposts.halo.run/bundle";

    private static final Logger log = LoggerFactory.getLogger(PostPrivatePostSyncListener.class);
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
        .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        .findAndRegisterModules();

    private final ReactiveExtensionClient client;
    private final PrivatePostService privatePostService;

    public PostPrivatePostSyncListener(ReactiveExtensionClient client,
                                       PrivatePostService privatePostService) {
        this.client = client;
        this.privatePostService = privatePostService;
    }

    @EventListener
    public void onPostUpdated(PostUpdatedEvent event) {
        syncByPostName(event.getName());
    }

    @EventListener
    public void onPostPublished(PostPublishedEvent event) {
        syncByPostName(event.getName());
    }

    @EventListener
    public void onPostUnpublished(PostUnpublishedEvent event) {
        syncByPostName(event.getName());
    }

    @EventListener
    public void onPostVisibleChanged(PostVisibleChangedEvent event) {
        syncByPostName(event.getName());
    }

    @EventListener
    public void onPostDeleted(PostDeletedEvent event) {
        privatePostService.deleteByPostName(event.getName())
            .onErrorResume(error -> {
                log.warn("Failed to delete private post mapping for {}.", event.getName(), error);
                return Mono.empty();
            })
            .subscribe();
    }

    private void syncByPostName(String postName) {
        client.fetch(Post.class, postName)
            .flatMap(this::syncFromPost)
            .onErrorResume(error -> {
                log.warn("Failed to sync private post mapping for {}.", postName, error);
                return Mono.empty();
            })
            .subscribe();
    }

    private Mono<Void> syncFromPost(Post post) {
        String postName = post.getMetadata().getName();
        if (post.isDeleted() || Post.isRecycled(post.getMetadata())) {
            return privatePostService.deleteByPostName(postName);
        }

        Map<String, String> annotations = post.getMetadata() == null
            ? null
            : post.getMetadata().getAnnotations();
        PrivatePost.Bundle bundle = readBundleFromAnnotations(postName, annotations);
        if (bundle == null) {
            return privatePostService.deleteByPostName(postName);
        }

        return syncBundle(post, bundle);
    }

    private Mono<Void> syncBundle(Post post, PrivatePost.Bundle bundle) {
        PrivatePost privatePost = new PrivatePost();
        PrivatePost.PrivatePostSpec spec = new PrivatePost.PrivatePostSpec();
        spec.setPostName(post.getMetadata().getName());
        spec.setSlug(post.getSpec().getSlug());
        spec.setTitle(post.getSpec().getTitle());
        spec.setExcerpt(readExcerpt(post));
        spec.setPublishedAt(readPublishedAt(post.getSpec().getPublishTime()));
        spec.setBundle(bundle);
        privatePost.setSpec(spec);

        return privatePostService.upsert(privatePost).then();
    }

    @Nullable
    public static PrivatePost.Bundle readBundleFromAnnotations(String postName,
                                                               @Nullable Map<String, String> annotations) {
        if (annotations == null) {
            return null;
        }

        String bundleText = annotations.get(PRIVATE_POST_BUNDLE_ANNOTATION);
        if (!StringUtils.hasText(bundleText)) {
            return null;
        }

        try {
            PrivatePost.Bundle bundle = OBJECT_MAPPER.readValue(bundleText, PrivatePost.Bundle.class);
            if (isValidBundle(bundle)) {
                return bundle;
            }

            log.warn("Incomplete private post bundle annotation on post {}.", postName);
            return null;
        } catch (JsonProcessingException error) {
            log.warn("Invalid private post bundle annotation on post {}.", postName, error);
            return null;
        }
    }

    private static boolean isValidBundle(@Nullable PrivatePost.Bundle bundle) {
        if (bundle == null || bundle.getMetadata() == null || bundle.getVersion() == null) {
            return false;
        }

        return bundle.getVersion() == 2
            && StringUtils.hasText(bundle.getPayloadFormat())
            && StringUtils.hasText(bundle.getCipher())
            && StringUtils.hasText(bundle.getKdf())
            && StringUtils.hasText(bundle.getDataIv())
            && StringUtils.hasText(bundle.getCiphertext())
            && StringUtils.hasText(bundle.getAuthTag())
            && isValidPasswordSlot(bundle.getPasswordSlot())
            && isValidRecoverySlot(bundle.getRecoverySlot())
            && StringUtils.hasText(bundle.getMetadata().getSlug())
            && StringUtils.hasText(bundle.getMetadata().getTitle());
    }

    private static boolean isValidPasswordSlot(@Nullable PrivatePost.PasswordSlot passwordSlot) {
        return passwordSlot != null
            && StringUtils.hasText(passwordSlot.getKdf())
            && StringUtils.hasText(passwordSlot.getSalt())
            && StringUtils.hasText(passwordSlot.getWrapIv())
            && StringUtils.hasText(passwordSlot.getWrappedCek())
            && StringUtils.hasText(passwordSlot.getAuthTag());
    }

    private static boolean isValidRecoverySlot(@Nullable PrivatePost.RecoverySlot recoverySlot) {
        return recoverySlot != null
            && StringUtils.hasText(recoverySlot.getScheme())
            && StringUtils.hasText(recoverySlot.getWrapAlg())
            && StringUtils.hasText(recoverySlot.getWrapIv())
            && StringUtils.hasText(recoverySlot.getWrappedCek())
            && StringUtils.hasText(recoverySlot.getAuthTag());
    }

    private static String readExcerpt(Post post) {
        if (post.getSpec() != null
            && post.getSpec().getExcerpt() != null
            && StringUtils.hasText(post.getSpec().getExcerpt().getRaw())) {
            return post.getSpec().getExcerpt().getRaw();
        }

        if (post.getStatus() != null && StringUtils.hasText(post.getStatus().getExcerpt())) {
            return post.getStatus().getExcerpt();
        }

        return null;
    }

    private static String readPublishedAt(@Nullable Instant publishTime) {
        return publishTime == null ? null : publishTime.toString();
    }
}
