import { describe, expect, it } from 'vitest'

import { resolvePrivatePostListLockState } from './private-post-list-lock-state'

describe('resolvePrivatePostListLockState', () => {
  it('prefers a valid source bundle annotation over the registry mirror', () => {
    expect(resolvePrivatePostListLockState({
      sourceAnnotationsPresent: true,
      sourceBundleText: validBundleText(),
      registryLoaded: true,
      registryHasPrivatePost: false,
    })).toEqual({
      resolved: true,
      locked: true,
    })
  })

  it('treats a present but empty source annotation as unlocked', () => {
    expect(resolvePrivatePostListLockState({
      sourceAnnotationsPresent: true,
      sourceBundleText: '   ',
      registryLoaded: true,
      registryHasPrivatePost: true,
    })).toEqual({
      resolved: true,
      locked: false,
    })
  })

  it('treats an invalid source bundle annotation as unlocked', () => {
    expect(resolvePrivatePostListLockState({
      sourceAnnotationsPresent: true,
      sourceBundleText: '{"version":3}',
      registryLoaded: true,
      registryHasPrivatePost: true,
    })).toEqual({
      resolved: true,
      locked: false,
    })
  })

  it('falls back to the registry when the list response has no annotations payload', () => {
    expect(resolvePrivatePostListLockState({
      sourceAnnotationsPresent: false,
      sourceBundleText: '',
      registryLoaded: true,
      registryHasPrivatePost: true,
    })).toEqual({
      resolved: true,
      locked: true,
    })
  })

  it('stays unresolved until the registry loads when no source annotations are available', () => {
    expect(resolvePrivatePostListLockState({
      sourceAnnotationsPresent: false,
      sourceBundleText: '',
      registryLoaded: false,
      registryHasPrivatePost: false,
    })).toEqual({
      resolved: false,
      locked: false,
    })
  })
})

function validBundleText(): string {
  return JSON.stringify({
    version: 3,
    payload_format: 'markdown',
    cipher: 'aes-256-gcm',
    kdf: 'envelope',
    data_iv: '00112233445566778899aabb',
    ciphertext: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    auth_tag: '00112233445566778899aabbccddeeff',
    password_slot: {
      kdf: 'scrypt',
      salt: '00112233445566778899aabbccddeeff',
      wrap_iv: '00112233445566778899aabb',
      wrapped_cek: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      auth_tag: '00112233445566778899aabbccddeeff',
    },
    site_recovery_slot: {
      kid: 'site-recovery-rsa-oaep-sha256-v1',
      alg: 'RSA-OAEP-256',
      wrapped_cek: '11'.repeat(384),
    },
    metadata: {
      slug: 'demo-post',
      title: 'Demo Post',
    },
  })
}
