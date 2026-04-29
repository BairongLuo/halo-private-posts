import './reader.css'

import type { PrivatePostView } from '@/types/private-post'
import {
  decryptPrivatePost,
  renderPrivatePostDocument,
} from '@/utils/private-post-crypto'

declare global {
  interface Window {
    haloPrivatePostsMountReaders?: () => void
    haloPrivatePostsReaderInitialized?: boolean
  }
}

if (!window.haloPrivatePostsReaderInitialized) {
  window.haloPrivatePostsReaderInitialized = true
  window.haloPrivatePostsMountReaders = mountAllReaders
  mountAllReaders()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAllReaders, { once: true })
  }

  installReaderObserver()
}

function mountAllReaders() {
  document.querySelectorAll<HTMLElement>('[data-halo-private-post-reader]').forEach((root) => {
    void bootReader(root)
  })
}

function installReaderObserver() {
  if (typeof MutationObserver === 'undefined') {
    return
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.some(containsReaderMount)) {
      mountAllReaders()
    }
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

function containsReaderMount(mutation: MutationRecord): boolean {
  return Array.from(mutation.addedNodes).some((node) => {
    if (!(node instanceof HTMLElement)) {
      return false
    }

    return node.matches('[data-halo-private-post-reader]')
      || Boolean(node.querySelector('[data-halo-private-post-reader]'))
  })
}

async function bootReader(element: HTMLElement) {
  if (element.dataset.hppMounted === 'true') {
    return
  }

  const bundleUrl = element.dataset.bundleUrl
  const layout = element.dataset.hppLayout ?? 'standalone'
  const idleTimeoutMs = Number.parseInt(element.dataset.idleTimeoutMs ?? '300000', 10)
  const form = element.querySelector<HTMLFormElement>('[data-hpp-form]')
  const passwordInput = element.querySelector<HTMLInputElement>('[data-hpp-password]')
  const submitButton = element.querySelector<HTMLButtonElement>('[data-hpp-submit]')
  const status = element.querySelector<HTMLParagraphElement>('[data-hpp-status]')
  const lockPanel = element.querySelector<HTMLDivElement>('[data-hpp-lock-panel]')
  const content = element.querySelector<HTMLElement>('[data-hpp-content]')
  const themedHost = resolveThemedInlineHost(element, layout)

  if (!bundleUrl || !form || !passwordInput || !submitButton || !status || !lockPanel || !content) {
    return
  }

  element.dataset.hppMounted = 'true'

  let idleTimer: number | undefined
  let activityListenersEnabled = false
  let inlineThemeUnlocked = false
  const themedHostMarkup = themedHost?.innerHTML ?? null
  const lifecycleController = new AbortController()
  const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'touchstart']
  const isUnlocked = () => inlineThemeUnlocked || !content.hidden

  const relock = (message: string) => {
    if (idleTimer) {
      window.clearTimeout(idleTimer)
      idleTimer = undefined
    }

    if (themedHost && themedHostMarkup !== null && inlineThemeUnlocked) {
      inlineThemeUnlocked = false
      activityListenersEnabled = false
      lifecycleController.abort()
      themedHost.innerHTML = themedHostMarkup
      themedHost.removeAttribute('data-hpp-unlocked')

      const restoredStatus = themedHost.querySelector<HTMLElement>('[data-hpp-status]')
      if (restoredStatus) {
        setStatus(restoredStatus, 'neutral', message)
      }

      const restoredRoot = themedHost.querySelector<HTMLElement>('[data-halo-private-post-reader]')
      if (restoredRoot) {
        void bootReader(restoredRoot)
      }

      return
    }

    content.innerHTML = ''
    content.hidden = true
    lockPanel.hidden = false
    passwordInput.value = ''
    setStatus(status, 'neutral', message)
    toggleActivityListeners(false)
  }

  const armIdleRelock = () => {
    if (idleTimer) {
      window.clearTimeout(idleTimer)
    }

    idleTimer = window.setTimeout(() => {
      relock('空闲时间过长，正文已重新锁定。')
    }, idleTimeoutMs)
  }

  const toggleActivityListeners = (enabled: boolean) => {
    if (activityListenersEnabled === enabled) {
      return
    }

    activityListenersEnabled = enabled

    activityEvents.forEach((eventName) => {
      if (enabled) {
        window.addEventListener(eventName, armIdleRelock, {
          passive: true,
          signal: lifecycleController.signal,
        })
      } else {
        window.removeEventListener(eventName, armIdleRelock)
      }
    })
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isUnlocked()) {
      relock('标签页已隐藏，正文已重新锁定。')
    }
  }, { signal: lifecycleController.signal })

  window.addEventListener('pagehide', () => {
    if (isUnlocked()) {
      relock('你已离开页面，正文已重新锁定。')
    }
  }, { signal: lifecycleController.signal })

  const setBusy = (busy: boolean) => {
    submitButton.disabled = busy
  }

  const revealContent = (renderedHtml: string, message: string) => {
    if (themedHost && themedHostMarkup !== null) {
      inlineThemeUnlocked = true
      themedHost.innerHTML = renderedHtml
      themedHost.dataset.hppUnlocked = 'true'
    } else {
      content.innerHTML = renderedHtml
      content.hidden = false
      lockPanel.hidden = true
      setStatus(status, 'success', message)
    }

    armIdleRelock()
    toggleActivityListeners(true)
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const password = passwordInput.value
    if (!password) {
      setStatus(status, 'error', '请输入访问密码。')
      return
    }

    setBusy(true)
    setStatus(status, 'neutral', '正在拉取密文并在浏览器中解密…')

    try {
      const view = await fetchPrivatePostView(bundleUrl)
      const decrypted = await decryptPrivatePost(view.bundle, password)
      const renderedHtml = await renderPrivatePostDocument(decrypted)

      revealContent(
        renderedHtml,
        '正文已在浏览器中解密。'
      )
    } catch (error) {
      setStatus(status, 'error', toMessage(error))
      passwordInput.select()
    } finally {
      setBusy(false)
    }
  })
}

async function fetchPrivatePostView(bundleUrl: string): Promise<PrivatePostView> {
  const response = await fetch(bundleUrl, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('无法加载私密文章 bundle')
  }

  return (await response.json()) as PrivatePostView
}

function setStatus(element: HTMLElement, state: 'neutral' | 'success' | 'error', message: string) {
  element.dataset.status = state
  element.textContent = message
}

function resolveThemedInlineHost(element: HTMLElement, layout: string): HTMLElement | null {
  if (layout !== 'inline') {
    return null
  }

  const parent = element.parentElement
  if (!parent || parent.firstElementChild !== element || parent.children.length !== 1) {
    return null
  }

  if (
    parent.matches('[itemprop="articleBody"]')
    || parent.matches('.content, .post-content, .entry-content, .article-content, .markdown-body, .prose')
  ) {
    return parent
  }

  return null
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
