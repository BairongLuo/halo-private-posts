// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const decryptPrivatePost = vi.fn()
const renderPrivatePostDocument = vi.fn()

vi.mock('@/utils/private-post-crypto', () => ({
  decryptPrivatePost,
  renderPrivatePostDocument,
}))

describe('reader', () => {
  beforeAll(async () => {
    await import('./reader')
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    decryptPrivatePost.mockReset()
    renderPrivatePostDocument.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('mounts a standalone reader, unlocks content, and relocks on pagehide', async () => {
    document.body.innerHTML = `
      <div
        data-halo-private-post-reader
        data-bundle-url="/private-posts/data?slug=demo-post"
        data-idle-timeout-ms="300000"
      >
        <form data-hpp-form>
          <input data-hpp-password />
          <button data-hpp-submit type="submit">解锁</button>
        </form>
        <p data-hpp-status data-status="neutral">初始状态</p>
        <div data-hpp-lock-panel></div>
        <div data-hpp-content hidden></div>
      </div>
    `

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        bundle: {
          version: 3,
        },
      }),
    } as Response)
    decryptPrivatePost.mockResolvedValue({
      metadata: {
        slug: 'demo-post',
        title: 'Demo Post',
      },
      payload_format: 'markdown',
      content: '# Demo',
    })
    renderPrivatePostDocument.mockResolvedValue('<p>Unlocked body</p>')

    window.haloPrivatePostsMountReaders?.()

    const form = document.querySelector<HTMLFormElement>('[data-hpp-form]')
    const passwordInput = document.querySelector<HTMLInputElement>('[data-hpp-password]')
    const content = document.querySelector<HTMLElement>('[data-hpp-content]')
    const status = document.querySelector<HTMLElement>('[data-hpp-status]')
    const lockPanel = document.querySelector<HTMLElement>('[data-hpp-lock-panel]')

    expect(form).not.toBeNull()
    expect(passwordInput).not.toBeNull()
    expect(content).not.toBeNull()
    expect(status).not.toBeNull()
    expect(lockPanel).not.toBeNull()

    passwordInput!.value = 'Halo#2026'
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/private-posts/data?slug=demo-post', {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      })
      expect(content!.hidden).toBe(false)
      expect(content!.innerHTML).toBe('<p>Unlocked body</p>')
      expect(lockPanel!.hidden).toBe(true)
      expect(status!.dataset.status).toBe('success')
    })

    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => {
      expect(content!.hidden).toBe(true)
      expect(content!.innerHTML).toBe('')
      expect(lockPanel!.hidden).toBe(false)
      expect(passwordInput!.value).toBe('')
      expect(status!.dataset.status).toBe('neutral')
      expect(status!.textContent).toContain('正文已重新锁定')
    })
  })

  it('uses the themed inline host and restores the original lock UI after relock', async () => {
    document.body.innerHTML = `
      <div class="content">
        <div
          data-halo-private-post-reader
          data-hpp-layout="inline"
          data-bundle-url="/private-posts/data?slug=inline-post"
        >
          <form data-hpp-form>
            <input data-hpp-password />
            <button data-hpp-submit type="submit">解锁</button>
          </form>
          <p data-hpp-status data-status="neutral">初始状态</p>
          <div data-hpp-lock-panel></div>
          <div data-hpp-content hidden></div>
        </div>
      </div>
    `

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        bundle: {
          version: 3,
        },
      }),
    } as Response)
    decryptPrivatePost.mockResolvedValue({
      metadata: {
        slug: 'inline-post',
        title: 'Inline Post',
      },
      payload_format: 'html',
      content: '<p>Inline content</p>',
    })
    renderPrivatePostDocument.mockResolvedValue('<article><p>Inline content</p></article>')

    window.haloPrivatePostsMountReaders?.()

    const host = document.querySelector<HTMLElement>('.content')
    const form = host?.querySelector<HTMLFormElement>('[data-hpp-form]')
    const passwordInput = host?.querySelector<HTMLInputElement>('[data-hpp-password]')

    expect(host).not.toBeNull()
    expect(form).not.toBeNull()
    expect(passwordInput).not.toBeNull()

    passwordInput!.value = 'Halo#2026'
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(host!.dataset.hppUnlocked).toBe('true')
      expect(host!.innerHTML).toBe('<article><p>Inline content</p></article>')
    })

    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => {
      expect(host!.dataset.hppUnlocked).toBeUndefined()
      const restoredRoot = host!.querySelector<HTMLElement>('[data-halo-private-post-reader]')
      const restoredStatus = host!.querySelector<HTMLElement>('[data-hpp-status]')
      expect(restoredRoot).not.toBeNull()
      expect(restoredRoot!.dataset.hppMounted).toBe('true')
      expect(restoredStatus?.dataset.status).toBe('neutral')
      expect(restoredStatus?.textContent).toContain('正文已重新锁定')
    })
  })
})
