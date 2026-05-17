import { describe, expect, it } from 'vitest'

import { resolvePendingSaveAction } from '@/annotation/save-request'

describe('annotation pending save action logic', () => {
  it('locks when encryption is enabled and no bundle exists yet', () => {
    expect(resolvePendingSaveAction({
      encryptionEnabled: true,
      hasBundle: false,
    })).toBe('lock')
  })

  it('unlocks when encryption is disabled and a bundle exists', () => {
    expect(resolvePendingSaveAction({
      encryptionEnabled: false,
      hasBundle: true,
    })).toBe('unlock')
  })

  it('refreshes an existing encrypted bundle without requiring a local password', () => {
    expect(resolvePendingSaveAction({
      encryptionEnabled: true,
      hasBundle: true,
    })).toBe('refresh')
  })

  it('does nothing when encryption is disabled and no bundle exists', () => {
    expect(resolvePendingSaveAction({
      encryptionEnabled: false,
      hasBundle: false,
    })).toBe('none')
  })
})
