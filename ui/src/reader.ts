import './reader.css'

import type { PrivatePostView } from '@/types/private-post'
import { decryptPrivatePost, renderMarkdown } from '@/utils/private-post-crypto'

const root = document.getElementById('private-post-reader')

if (root) {
  void bootReader(root)
}

async function bootReader(element: HTMLElement) {
  const bundleUrl = element.dataset.bundleUrl
  const idleTimeoutMs = Number.parseInt(element.dataset.idleTimeoutMs ?? '300000', 10)
  const form = document.getElementById('hpp-form') as HTMLFormElement | null
  const passwordInput = document.getElementById('hpp-password') as HTMLInputElement | null
  const submitButton = document.getElementById('hpp-submit') as HTMLButtonElement | null
  const status = document.getElementById('hpp-status') as HTMLParagraphElement | null
  const lockPanel = document.getElementById('hpp-lock-panel') as HTMLDivElement | null
  const content = document.getElementById('hpp-content') as HTMLElement | null

  if (!bundleUrl || !form || !passwordInput || !submitButton || !status || !lockPanel || !content) {
    return
  }

  let cachedView: PrivatePostView | null = null
  let idleTimer: number | undefined
  const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'touchstart']

  const relock = (message: string) => {
    if (idleTimer) {
      window.clearTimeout(idleTimer)
      idleTimer = undefined
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
    activityEvents.forEach((eventName) => {
      if (enabled) {
        window.addEventListener(eventName, armIdleRelock, { passive: true })
      } else {
        window.removeEventListener(eventName, armIdleRelock)
      }
    })
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !content.hidden) {
      relock('标签页已隐藏，正文已重新锁定。')
    }
  })

  window.addEventListener('pagehide', () => {
    if (!content.hidden) {
      relock('你已离开页面，正文已重新锁定。')
    }
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const password = passwordInput.value
    if (!password) {
      setStatus(status, 'error', '请输入访问密码。')
      return
    }

    submitButton.disabled = true
    setStatus(status, 'neutral', '正在拉取密文并在浏览器中解密…')

    try {
      if (!cachedView) {
        cachedView = await fetchPrivatePostView(bundleUrl)
      }

      const decrypted = await decryptPrivatePost(cachedView.bundle, password)
      content.innerHTML = await renderMarkdown(decrypted.markdown)
      content.hidden = false
      lockPanel.hidden = true
      setStatus(
        status,
        'success',
        '正文已在浏览器中解密。切后台、离开页面或空闲超时后会重新锁定。'
      )
      armIdleRelock()
      toggleActivityListeners(true)
    } catch (error) {
      setStatus(status, 'error', toMessage(error))
      passwordInput.select()
    } finally {
      submitButton.disabled = false
    }
  })
}

async function fetchPrivatePostView(bundleUrl: string): Promise<PrivatePostView> {
  const response = await fetch(bundleUrl, {
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

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
