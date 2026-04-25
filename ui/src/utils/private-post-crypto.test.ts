import { webcrypto } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { generateAuthorKeyRecord } from './author-key-crypto'
import {
  decryptPrivatePost,
  decryptPrivatePostWithAuthorKey,
  encryptPrivatePost,
  rewrapPrivatePostPassword,
} from './private-post-crypto'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
}

describe('private post envelope encryption', () => {
  it('round-trips a browser-generated bundle with password slot', async () => {
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'posts/halo-private-posts',
          title: 'Halo Private Posts',
          excerpt: 'Editor generated bundle',
          published_at: '2026-04-24T00:00:00Z',
        },
        markdown: '# Private\n\nHello from the editor block.',
      },
      'editor-password'
    )

    const document = await decryptPrivatePost(bundle, 'editor-password')

    expect(bundle.version).toBe(2)
    expect(bundle.payload_format).toBe('markdown')
    expect(bundle.cipher).toBe('aes-256-gcm')
    expect(bundle.kdf).toBe('envelope')
    expect(bundle.password_slot.kdf).toBe('scrypt')
    expect(bundle.author_slots).toHaveLength(0)
    expect(document.metadata.slug).toBe('posts/halo-private-posts')
    expect(document.metadata.title).toBe('Halo Private Posts')
    expect(document.metadata.excerpt).toBe('Editor generated bundle')
    expect(document.metadata.published_at).toBe('2026-04-24T00:00:00Z')
    expect(document.markdown).toBe('# Private\n\nHello from the editor block.')
  })

  it('supports author slots for password-independent recovery', async () => {
    const authorKey = await generateAuthorKeyRecord({
      ownerName: 'tester',
      displayName: 'Test Author Key',
    })
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'posts/with-author-slot',
          title: 'With Author Slot',
        },
        markdown: '# Author Slot\n\nRecovered with private key.',
      },
      'reader-password',
      [
        {
          keyId: authorKey.fingerprint,
          algorithm: authorKey.algorithm,
          publicKey: authorKey.publicKey,
        },
      ]
    )

    const document = await decryptPrivatePostWithAuthorKey(bundle, authorKey.privateKey)

    expect(bundle.author_slots).toHaveLength(1)
    expect(bundle.author_slots[0].key_id).toBe(authorKey.fingerprint)
    expect(document.metadata.slug).toBe('posts/with-author-slot')
    expect(document.markdown).toBe('# Author Slot\n\nRecovered with private key.')
  })

  it('rewraps only the password slot when resetting the password', async () => {
    const authorKey = await generateAuthorKeyRecord({
      ownerName: 'tester',
      displayName: 'Reset Password Key',
    })
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'posts/reset-password',
          title: 'Reset Password',
        },
        markdown: '# Reset\n\nPassword slot only.',
      },
      'old-password',
      [
        {
          keyId: authorKey.fingerprint,
          algorithm: authorKey.algorithm,
          publicKey: authorKey.publicKey,
        },
      ]
    )

    const rewrapped = await rewrapPrivatePostPassword(
      bundle,
      'new-password',
      authorKey.privateKey
    )

    await expect(decryptPrivatePost(rewrapped, 'old-password')).rejects.toThrow(
      '访问密码错误，或密文已损坏'
    )

    const passwordDocument = await decryptPrivatePost(rewrapped, 'new-password')
    const authorDocument = await decryptPrivatePostWithAuthorKey(rewrapped, authorKey.privateKey)

    expect(rewrapped.version).toBe(bundle.version)
    expect(rewrapped.ciphertext).toBe(bundle.ciphertext)
    expect(rewrapped.auth_tag).toBe(bundle.auth_tag)
    expect(rewrapped.data_iv).toBe(bundle.data_iv)
    expect(rewrapped.author_slots).toEqual(bundle.author_slots)
    expect(rewrapped.password_slot.wrapped_cek).not.toBe(bundle.password_slot.wrapped_cek)
    expect(passwordDocument.markdown).toBe('# Reset\n\nPassword slot only.')
    expect(authorDocument.markdown).toBe('# Reset\n\nPassword slot only.')
  })
})
