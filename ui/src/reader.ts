import './reader.css'

declare global {
  interface Window {
    haloPrivatePostsMountHiders?: () => void
    haloPrivatePostsHiderInitialized?: boolean
  }
}

if (!window.haloPrivatePostsHiderInitialized) {
  window.haloPrivatePostsHiderInitialized = true
  window.haloPrivatePostsMountHiders = mountAllHiders
  mountAllHiders()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAllHiders, { once: true })
  }

  installHiderObserver()
}

function mountAllHiders() {
  document.querySelectorAll<HTMLElement>('[data-halo-private-post-hide]').forEach((root) => {
    void bootHider(root)
  })
}

function installHiderObserver() {
  if (typeof MutationObserver === 'undefined') {
    return
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some(containsHiderMount)) {
      mountAllHiders()
    }
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

function containsHiderMount(mutation: MutationRecord): boolean {
  return Array.from(mutation.addedNodes).some((node) => {
    if (!(node instanceof HTMLElement)) {
      return false
    }
    return node.matches('[data-halo-private-post-hide]')
      || Boolean(node.querySelector('[data-halo-private-post-hide]'))
  })
}

async function bootHider(element: HTMLElement) {
  if (element.dataset.hppMounted === 'true') {
    return
  }

  const postName = element.dataset.hidePost
  const verifyUrl = element.dataset.hideVerifyUrl
  const form = element.querySelector<HTMLFormElement>('[data-hpp-form]')
  const passwordInput = element.querySelector<HTMLInputElement>('[data-hpp-password]')
  const submitButton = element.querySelector<HTMLButtonElement>('[data-hpp-submit]')
  const status = element.querySelector<HTMLElement>('[data-hpp-status]')
  const lockPanel = element.querySelector<HTMLElement>('[data-hpp-lock-panel]')
  const content = element.querySelector<HTMLElement>('[data-hpp-content]')

  if (!postName || !verifyUrl || !form || !passwordInput || !submitButton || !status || !lockPanel || !content) {
    return
  }

  element.dataset.hppMounted = 'true'

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const password = passwordInput.value
    if (!password) {
      setStatus(status, 'error', '请输入访问密码。')
      return
    }

    setBusy(submitButton, true)
    setStatus(status, 'neutral', '正在校验密码…')

    try {
      const segments = await verifyPassword(verifyUrl, postName, password)
      revealHiders(postName, segments)
    } catch (error) {
      setStatus(status, 'error', toMessage(error))
      passwordInput.select()
    } finally {
      setBusy(submitButton, false)
    }
  })
}

async function verifyPassword(verifyUrl: string, postName: string, password: string): Promise<string[]> {
  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ postName, password }),
  })

  if (response.status === 401) {
    throw new Error(await readErrorMessage(response, '访问密码错误'))
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(
      response,
      `无法校验密码（HTTP ${response.status}）`,
    ))
  }

  const data: unknown = await response.json()
  if (!isVerifyResponse(data)) {
    throw new Error('校验服务返回了无效数据')
  }
  return data.segments
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (typeof data !== 'object' || data === null) {
      return fallback
    }
    const errorBody = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'title'] as const) {
      const value = errorBody[key]
      if (typeof value === 'string' && value.trim()) {
        return value
      }
    }
  } catch {
    // Halo 或反向代理可能返回非 JSON 错误页。
  }
  return fallback
}

function revealHiders(postName: string, segments: string[]) {
  const hiders = Array.from(
    document.querySelectorAll<HTMLElement>('[data-halo-private-post-hide]'),
  ).filter((element) => element.dataset.hidePost === postName)

  const indexedHiders = hiders.map((element) => ({
    element,
    index: Number.parseInt(element.dataset.hideIndex ?? '', 10),
  }))
  if (indexedHiders.some(({ index }) => !Number.isInteger(index) || index < 0 || index >= segments.length)) {
    throw new Error('页面内容已变更，请刷新后重试')
  }

  indexedHiders.forEach(({ element, index }) => {
    const segment = segments[index] ?? ''
    const content = element.querySelector<HTMLElement>('[data-hpp-content]')
    const lockPanel = element.querySelector<HTMLElement>('[data-hpp-lock-panel]')
    const status = element.querySelector<HTMLElement>('[data-hpp-status]')

    if (!content) {
      return
    }

    content.innerHTML = renderSegment(segment)
    content.hidden = false
    if (lockPanel) {
      lockPanel.hidden = true
    }
    if (status) {
      setStatus(status, 'success', '已解锁')
    }
  })
}

function isVerifyResponse(value: unknown): value is { segments: string[] } {
  if (typeof value !== 'object' || value === null || !('segments' in value)) {
    return false
  }
  return Array.isArray(value.segments) && value.segments.every((segment) => typeof segment === 'string')
}

function renderSegment(segment: string): string {
  // 服务端返回的是渲染后的 HTML 片段，直接插入即可。
  return segment
}

function setStatus(element: HTMLElement, state: 'neutral' | 'success' | 'error', message: string) {
  element.dataset.status = state
  element.textContent = message
  element.hidden = message.length === 0
}

function setBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy
}

function toMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof error.message === 'string'
    && error.message.trim().length > 0
  ) {
    return error.message
  }

  return '未知错误'
}
