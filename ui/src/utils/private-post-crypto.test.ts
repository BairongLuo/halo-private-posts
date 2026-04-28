import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type {
  SiteRecoveryPublicKey,
} from '@/types/private-post'
import {
  decryptPrivatePost,
  encryptPrivatePost,
} from '@/utils/private-post-crypto'

describe('private-post-crypto', () => {
  it('encrypts a v3 bundle with site recovery slot and decrypts it with password', async () => {
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'demo-post',
          title: 'Demo Post',
        },
        payload_format: 'markdown',
        content: '# Demo\n\nPrivate content',
      },
      'Halo#2026',
      createSiteRecoveryPublicKey()
    )

    expect(bundle.version).toBe(3)
    expect(bundle.site_recovery_slot?.alg).toBe('RSA-OAEP-256')

    await expect(decryptPrivatePost(bundle, 'Halo#2026')).resolves.toMatchObject({
      metadata: {
        slug: 'demo-post',
        title: 'Demo Post',
      },
      payload_format: 'markdown',
      content: '# Demo\n\nPrivate content',
    })
  })
})

function createSiteRecoveryPublicKey(): SiteRecoveryPublicKey {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
  })

  return {
    kid: 'site-recovery-rsa-oaep-sha256-v1',
    alg: 'RSA-OAEP-256',
    publicKey: publicKey.export({
      type: 'spki',
      format: 'der',
    }).toString('base64'),
  }
}
