import { createApp, type App } from 'vue'

import HidePasswordPanel from './components/HidePasswordPanel.vue'
import { PASSWORD_CONFIG_FIELD_ID } from './annotation-field'

const SLOT_SELECTOR = '[data-hpp-hide-password-slot]'
const HOST_ID = 'hpp-hide-password-host'

let installed = false
let mountedApp: App<Element> | null = null
let mountedContainer: HTMLElement | null = null

export function installHidePasswordPanel() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  installed = true

  const sync = () => {
    if (!ensureSlot()) {
      return
    }
    ensureMount()
  }

  sync()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      sync()
    }, { once: true })
  }

  const observer = new MutationObserver(sync)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })

  window.addEventListener('hashchange', sync)
  window.addEventListener('popstate', sync)
}

/**
 * 优先使用 AnnotationSetting 渲染的 slot div；若不存在，则找 FormKit 的 hidden
 * 字段（该字段一定会渲染），在它前面造一个 fallback slot。
 */
function ensureSlot(): boolean {
  if (document.querySelector(SLOT_SELECTOR)) {
    return true
  }

  const hiddenField = findHiddenField()
  if (!hiddenField) {
    return false
  }

  const parent = hiddenField.parentElement
  if (!parent) {
    return false
  }

  const slot = document.createElement('div')
  slot.setAttribute('data-hpp-hide-password-slot', 'true')
  slot.setAttribute('data-hpp-hide-password-slot-fallback', 'true')
  parent.insertBefore(slot, hiddenField)
  return true
}

function ensureMount() {
  let host = document.getElementById(HOST_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = HOST_ID
    host.style.display = 'contents'
    document.body.appendChild(host)
  }

  if (mountedApp && mountedContainer === host) {
    return
  }

  if (mountedApp) {
    mountedApp.unmount()
    mountedApp = null
  }

  mountedApp = createApp(HidePasswordPanel, {
    mountSelector: SLOT_SELECTOR,
  })
  mountedApp.mount(host)
  mountedContainer = host
}

function findHiddenField(): HTMLElement | null {
  const element = document.getElementById(PASSWORD_CONFIG_FIELD_ID)
  if (!element) {
    return null
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element
  }

  const nested = element.querySelector('input, textarea')
  if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement) {
    return nested
  }

  return element
}
