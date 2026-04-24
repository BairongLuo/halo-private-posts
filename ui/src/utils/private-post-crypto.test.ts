import { webcrypto } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import bundleFixture from '../../../fixtures/private-post/v1/reference-hello/bundle.json'
import documentFixture from '../../../fixtures/private-post/v1/reference-hello/document.json'
import { decryptPrivatePost } from './private-post-crypto'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
}

describe('decryptPrivatePost', () => {
  it('decrypts the shared ZKVault v1 fixture', async () => {
    const document = await decryptPrivatePost(bundleFixture, 'fixture-password-v1')

    expect(document.metadata.slug).toBe(documentFixture.metadata.slug)
    expect(document.metadata.title).toBe(documentFixture.metadata.title)
    expect(document.markdown).toBe(documentFixture.markdown)
  })
})
