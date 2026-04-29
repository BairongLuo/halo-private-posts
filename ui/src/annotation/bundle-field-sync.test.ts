import { describe, expect, it } from 'vitest'

import { resolveBundleFieldSyncState } from './bundle-field-sync'

describe('resolveBundleFieldSyncState', () => {
  it('accepts the dom value when there is no optimistic bundle text', () => {
    expect(resolveBundleFieldSyncState({
      bundleText: '',
      domValue: '{"version":3}',
      optimisticBundleText: null,
    })).toEqual({
      bundleText: '{"version":3}',
      optimisticBundleText: null,
      shouldUpdateBundleText: true,
    })
  })

  it('keeps the optimistic value when the dom still exposes a stale value', () => {
    expect(resolveBundleFieldSyncState({
      bundleText: '{"version":3}',
      domValue: '',
      optimisticBundleText: '{"version":3}',
    })).toEqual({
      bundleText: '{"version":3}',
      optimisticBundleText: '{"version":3}',
      shouldUpdateBundleText: false,
    })
  })

  it('clears the optimistic guard once the dom catches up', () => {
    expect(resolveBundleFieldSyncState({
      bundleText: '{"version":3}',
      domValue: '{"version":3}',
      optimisticBundleText: '{"version":3}',
    })).toEqual({
      bundleText: '{"version":3}',
      optimisticBundleText: null,
      shouldUpdateBundleText: false,
    })
  })

  it('keeps an optimistic clear while the dom still exposes the old bundle', () => {
    expect(resolveBundleFieldSyncState({
      bundleText: '',
      domValue: '{"version":3}',
      optimisticBundleText: '',
    })).toEqual({
      bundleText: '',
      optimisticBundleText: '',
      shouldUpdateBundleText: false,
    })
  })
})
