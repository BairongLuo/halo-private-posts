// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

describe('reader', () => {
  beforeAll(async () => {
    await import('./reader')
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.stubGlobal('fetch', vi.fn())
  })

  function mountHider() {
    document.body.innerHTML = `
      <section
        data-halo-private-post-hide="true"
        data-hide-post="demo-post"
        data-hide-index="0"
        data-hide-verify-url="/apis/api.privateposts.halo.run/v1alpha1/hide-password/verify"
      >
        <div data-hpp-lock-panel>
          <p data-hpp-status data-status="neutral"></p>
          <form data-hpp-form>
            <input data-hpp-password />
            <button data-hpp-submit type="submit">解锁</button>
          </form>
        </div>
        <div data-hpp-content hidden></div>
      </section>
    `
    window.haloPrivatePostsMountHiders?.()
  }

  it('reveals hidden content after a successful password verify', async () => {
    mountHider()

    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ segments: ['https://example.com/file.zip'] }),
    } as Response)

    const form = document.querySelector<HTMLFormElement>('[data-hpp-form]')
    const passwordInput = document.querySelector<HTMLInputElement>('[data-hpp-password]')
    const content = document.querySelector<HTMLElement>('[data-hpp-content]')
    const lockPanel = document.querySelector<HTMLElement>('[data-hpp-lock-panel]')

    passwordInput!.value = 'secret'
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/apis/api.privateposts.halo.run/v1alpha1/hide-password/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ postName: 'demo-post', password: 'secret' }),
      })
      expect(content!.hidden).toBe(false)
      expect(content!.innerHTML).toContain('example.com/file.zip')
      expect(lockPanel!.hidden).toBe(true)
    })
  })

  it('shows an error message when the password is wrong', async () => {
    mountHider()

    vi.mocked(fetch).mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({ message: '访问密码错误' }),
    } as Response)

    const form = document.querySelector<HTMLFormElement>('[data-hpp-form]')
    const passwordInput = document.querySelector<HTMLInputElement>('[data-hpp-password]')
    const status = document.querySelector<HTMLElement>('[data-hpp-status]')
    const content = document.querySelector<HTMLElement>('[data-hpp-content]')

    passwordInput!.value = 'wrong'
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(status!.dataset.status).toBe('error')
      expect(status!.textContent).toBe('访问密码错误')
      expect(content!.hidden).toBe(true)
    })
  })

  it('keeps content locked when the response does not contain the rendered segment', async () => {
    mountHider()

    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ segments: [] }),
    } as Response)

    const form = document.querySelector<HTMLFormElement>('[data-hpp-form]')
    const passwordInput = document.querySelector<HTMLInputElement>('[data-hpp-password]')
    const status = document.querySelector<HTMLElement>('[data-hpp-status]')
    const content = document.querySelector<HTMLElement>('[data-hpp-content]')
    const lockPanel = document.querySelector<HTMLElement>('[data-hpp-lock-panel]')

    passwordInput!.value = 'secret'
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(status!.dataset.status).toBe('error')
      expect(status!.textContent).toBe('页面内容已变更，请刷新后重试')
      expect(content!.hidden).toBe(true)
      expect(lockPanel!.hidden).toBe(false)
    })
  })

  it('keeps content locked when the verify response shape is invalid', async () => {
    mountHider()

    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ segments: [123] }),
    } as Response)

    const form = document.querySelector<HTMLFormElement>('[data-hpp-form]')
    const passwordInput = document.querySelector<HTMLInputElement>('[data-hpp-password]')
    const status = document.querySelector<HTMLElement>('[data-hpp-status]')
    const content = document.querySelector<HTMLElement>('[data-hpp-content]')

    passwordInput!.value = 'secret'
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(status!.textContent).toBe('校验服务返回了无效数据')
      expect(content!.hidden).toBe(true)
    })
  })

  it('shows the server error instead of hiding the response status', async () => {
    mountHider()

    vi.mocked(fetch).mockResolvedValue({
      status: 403,
      ok: false,
      json: async () => ({ message: '公开接口被拒绝' }),
    } as Response)

    const form = document.querySelector<HTMLFormElement>('[data-hpp-form]')
    const passwordInput = document.querySelector<HTMLInputElement>('[data-hpp-password]')
    const status = document.querySelector<HTMLElement>('[data-hpp-status]')

    passwordInput!.value = 'secret'
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(status!.textContent).toBe('公开接口被拒绝')
    })
  })
})
