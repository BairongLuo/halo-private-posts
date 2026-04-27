import { webcrypto } from 'node:crypto'

import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import {
  createRecoveryMnemonicSetup,
  deriveRecoveryKeyFromMnemonic,
} from './recovery-phrase'
import {
  decryptPrivatePost,
  decryptPrivatePostWithRecoveryPhrase,
  encryptPrivatePost,
  renderMarkdown,
  renderPrivatePostDocument,
  rewrapPrivatePostPasswordWithKnownPassword,
  rewrapPrivatePostPasswordWithRecoveryPhrase,
} from './private-post-crypto'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
}

if (typeof DOMParser === 'undefined') {
  const { window } = new JSDOM('')
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: window.DOMParser,
  })
}

describe('private post envelope encryption', () => {
  it('round-trips a browser-generated bundle with password and recovery slots', async () => {
    const recoverySetup = await createRecoveryMnemonicSetup()
    const recoveryKey = await deriveRecoveryKeyFromMnemonic(recoverySetup.mnemonic)
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'posts/halo-private-posts',
          title: 'Halo Private Posts',
          excerpt: 'Editor generated bundle',
          published_at: '2026-04-24T00:00:00Z',
        },
        payload_format: 'markdown',
        content: '# Private\n\nHello from the editor block.',
      },
      'editor-password',
      recoveryKey
    )

    const document = await decryptPrivatePost(bundle, 'editor-password')

    expect(bundle.version).toBe(2)
    expect(bundle.payload_format).toBe('markdown')
    expect(bundle.cipher).toBe('aes-256-gcm')
    expect(bundle.kdf).toBe('envelope')
    expect(bundle.password_slot.kdf).toBe('scrypt')
    expect(bundle.recovery_slot.scheme).toBe('mnemonic-v1')
    expect(bundle.recovery_slot.wrap_alg).toBe('aes-256-gcm')
    expect(document.metadata.slug).toBe('posts/halo-private-posts')
    expect(document.metadata.title).toBe('Halo Private Posts')
    expect(document.metadata.excerpt).toBe('Editor generated bundle')
    expect(document.metadata.published_at).toBe('2026-04-24T00:00:00Z')
    expect(document.payload_format).toBe('markdown')
    expect(document.content).toBe('# Private\n\nHello from the editor block.')
  })

  it('supports recovery phrase for password-independent recovery', async () => {
    const recoverySetup = await createRecoveryMnemonicSetup()
    const recoveryKey = await deriveRecoveryKeyFromMnemonic(recoverySetup.mnemonic)
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'posts/with-recovery-slot',
          title: 'With Recovery Slot',
        },
        payload_format: 'markdown',
        content: '# Recovery Slot\n\nRecovered with mnemonic.',
      },
      'reader-password',
      recoveryKey
    )

    const document = await decryptPrivatePostWithRecoveryPhrase(bundle, recoverySetup.mnemonic)

    expect(document.metadata.slug).toBe('posts/with-recovery-slot')
    expect(document.payload_format).toBe('markdown')
    expect(document.content).toBe('# Recovery Slot\n\nRecovered with mnemonic.')
  })

  it('rewraps password slot with known current password', async () => {
    const recoverySetup = await createRecoveryMnemonicSetup()
    const recoveryKey = await deriveRecoveryKeyFromMnemonic(recoverySetup.mnemonic)
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'posts/rotate-password',
          title: 'Rotate Password',
        },
        payload_format: 'markdown',
        content: '# Rotate\n\nKnown password path.',
      },
      'old-password',
      recoveryKey
    )

    const rewrapped = await rewrapPrivatePostPasswordWithKnownPassword(
      bundle,
      'old-password',
      'new-password'
    )

    await expect(decryptPrivatePost(rewrapped, 'old-password')).rejects.toThrow(
      '访问密码错误，或密文已损坏'
    )

    const passwordDocument = await decryptPrivatePost(rewrapped, 'new-password')
    const recoveryDocument = await decryptPrivatePostWithRecoveryPhrase(
      rewrapped,
      recoverySetup.mnemonic
    )

    expect(rewrapped.version).toBe(bundle.version)
    expect(rewrapped.ciphertext).toBe(bundle.ciphertext)
    expect(rewrapped.auth_tag).toBe(bundle.auth_tag)
    expect(rewrapped.data_iv).toBe(bundle.data_iv)
    expect(rewrapped.recovery_slot).toEqual(bundle.recovery_slot)
    expect(rewrapped.password_slot.wrapped_cek).not.toBe(bundle.password_slot.wrapped_cek)
    expect(passwordDocument.payload_format).toBe('markdown')
    expect(passwordDocument.content).toBe('# Rotate\n\nKnown password path.')
    expect(recoveryDocument.payload_format).toBe('markdown')
    expect(recoveryDocument.content).toBe('# Rotate\n\nKnown password path.')
  })

  it('rewraps password slot with recovery phrase when current password is unavailable', async () => {
    const recoverySetup = await createRecoveryMnemonicSetup()
    const recoveryKey = await deriveRecoveryKeyFromMnemonic(recoverySetup.mnemonic)
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'posts/reset-with-mnemonic',
          title: 'Reset With Mnemonic',
        },
        payload_format: 'markdown',
        content: '# Reset\n\nRecovery path.',
      },
      'initial-password',
      recoveryKey
    )

    const rewrapped = await rewrapPrivatePostPasswordWithRecoveryPhrase(
      bundle,
      recoverySetup.mnemonic,
      'recovered-password'
    )

    await expect(decryptPrivatePost(rewrapped, 'initial-password')).rejects.toThrow(
      '访问密码错误，或密文已损坏'
    )

    const passwordDocument = await decryptPrivatePost(rewrapped, 'recovered-password')
    expect(passwordDocument.payload_format).toBe('markdown')
    expect(passwordDocument.content).toBe('# Reset\n\nRecovery path.')
  })

  it('round-trips html payloads and sanitizes rendered html', async () => {
    const recoverySetup = await createRecoveryMnemonicSetup()
    const recoveryKey = await deriveRecoveryKeyFromMnemonic(recoverySetup.mnemonic)
    const bundle = await encryptPrivatePost(
      {
        metadata: {
          slug: 'posts/html-editor',
          title: 'HTML Editor',
        },
        payload_format: 'html',
        content: '<p>Hello <strong>HTML</strong></p><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">bad</a>',
      },
      'html-password',
      recoveryKey
    )

    const document = await decryptPrivatePost(bundle, 'html-password')
    const rendered = await renderPrivatePostDocument(document)

    expect(bundle.payload_format).toBe('html')
    expect(document.payload_format).toBe('html')
    expect(document.content).toContain('<p>Hello <strong>HTML</strong></p>')
    expect(rendered).toContain('<p>Hello <strong>HTML</strong></p>')
    expect(rendered).not.toContain('<script>')
    expect(rendered).not.toContain('javascript:alert(1)')
    expect(rendered).not.toContain('onclick=')
  })

  it('sanitizes raw html when rendering markdown', async () => {
    const html = await renderMarkdown(
      '# Safe\n\n<script>alert(1)</script>\n\n<div onclick="alert(1)">inline html</div>'
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;div onclick=&quot;alert(1)&quot;&gt;inline html&lt;/div&gt;')
  })

  it('drops unsafe link and image protocols when rendering markdown', async () => {
    const html = await renderMarkdown(
      '[unsafe](javascript:alert(1)) ![bad](data:text/html;base64,PHNjcmlwdD4=) [safe](/posts/halo)'
    )

    expect(html).not.toContain('javascript:alert(1)')
    expect(html).not.toContain('data:text/html')
    expect(html).toContain('<a href="/posts/halo" rel="nofollow noopener noreferrer">safe</a>')
  })
})
