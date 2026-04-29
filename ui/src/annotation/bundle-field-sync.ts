export interface BundleFieldSyncState {
  bundleText: string
  domValue: string
  optimisticBundleText: string | null
}

export interface BundleFieldSyncResult {
  bundleText: string
  optimisticBundleText: string | null
  shouldUpdateBundleText: boolean
}

export function resolveBundleFieldSyncState(
  state: BundleFieldSyncState
): BundleFieldSyncResult {
  if (state.optimisticBundleText !== null) {
    if (state.domValue === state.optimisticBundleText) {
      return {
        bundleText: state.domValue,
        optimisticBundleText: null,
        shouldUpdateBundleText: state.domValue !== state.bundleText,
      }
    }

    return {
      bundleText: state.bundleText,
      optimisticBundleText: state.optimisticBundleText,
      shouldUpdateBundleText: false,
    }
  }

  if (state.domValue === state.bundleText) {
    return {
      bundleText: state.bundleText,
      optimisticBundleText: null,
      shouldUpdateBundleText: false,
    }
  }

  return {
    bundleText: state.domValue,
    optimisticBundleText: null,
    shouldUpdateBundleText: true,
  }
}
