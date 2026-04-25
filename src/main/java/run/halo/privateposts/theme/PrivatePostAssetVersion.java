package run.halo.privateposts.theme;

final class PrivatePostAssetVersion {
    private static final String FALLBACK_VERSION = "dev";

    private PrivatePostAssetVersion() {
    }

    static String current() {
        String version = PrivatePostAssetVersion.class.getPackage().getImplementationVersion();
        if (version == null || version.isBlank()) {
            return FALLBACK_VERSION;
        }
        return version;
    }
}
