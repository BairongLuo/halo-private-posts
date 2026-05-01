import { createApp, type App } from 'vue'

import {
  findEditorSettingsButton,
  isEditorActionActive,
  isEditorActionDisabled,
} from './editor-dom'
import PrivatePostAnnotationTool from './PrivatePostAnnotationTool.vue'

const AUTO_OPEN_QUERY_KEY = 'hppOpenEncryption'
const BUNDLE_FIELD_ID = 'hpp-annotation-bundle'
const TOOL_SLOT_SELECTOR = '[data-hpp-annotation-tool-slot]'
const TOOL_HOST_ID = 'hpp-annotation-tool-host'

let installed = false
let mountedApp: App<Element> | null = null
let mountContainer: HTMLElement | null = null
let lastEditorRouteKey = ''
let pendingAutoOpenRouteKey = ''
let scheduledSyncFrame: number | null = null

export function installPrivatePostAnnotationTool(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  installed = true

  const syncAll = () => {
    scheduledSyncFrame = null
    syncPrivatePostAnnotationMount()
  }

  const scheduleSyncAll = () => {
    if (scheduledSyncFrame !== null) {
      return
    }

    scheduledSyncFrame = window.requestAnimationFrame(syncAll)
  }

  syncAll()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSyncAll, { once: true })
  }

  const observer = new MutationObserver(() => {
    scheduleSyncAll()
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })

  window.addEventListener('hashchange', scheduleSyncAll)
  window.addEventListener('popstate', scheduleSyncAll)
}

export function syncPrivatePostAnnotationMount(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  if (!isPostEditorPage()) {
    lastEditorRouteKey = ''
    pendingAutoOpenRouteKey = ''
    teardownMountedTool()
    return
  }

  const routeKey = getEditorRouteKey()
  if (routeKey !== lastEditorRouteKey) {
    lastEditorRouteKey = routeKey
    pendingAutoOpenRouteKey = ''
    teardownMountedTool()
  }

  if (shouldAutoOpenEncryptionPanel()) {
    pendingAutoOpenRouteKey = routeKey
    clearAutoOpenEncryptionFlag()
  }

  if (pendingAutoOpenRouteKey === routeKey) {
    if (tryActivateEditorSettings()) {
      pendingAutoOpenRouteKey = ''
    }
  }

  hideInternalBundleField()

  ensureMountHost()
}

function ensureMountHost(): void {
  const hostParent = document.body
  if (!hostParent) {
    teardownMountedToolIfDetached()
    return
  }

  const existingHost = document.getElementById(TOOL_HOST_ID)
  if (existingHost) {
    mountAnnotationTool(existingHost)
    return
  }

  const nextHost = document.createElement('div')
  nextHost.id = TOOL_HOST_ID
  nextHost.setAttribute('data-hpp-annotation-tool-host', 'true')
  nextHost.style.display = 'contents'
  hostParent.appendChild(nextHost)
  mountAnnotationTool(nextHost)
}

function mountAnnotationTool(container: HTMLElement): void {
  if (mountedApp && mountContainer === container) {
    return
  }

  teardownMountedTool()
  mountedApp = createApp(PrivatePostAnnotationTool, {
    bundleFieldId: BUNDLE_FIELD_ID,
    mountSelector: TOOL_SLOT_SELECTOR,
  })
  mountedApp.mount(container)
  mountContainer = container
}

function teardownMountedToolIfDetached(): void {
  if (!mountContainer || mountContainer.isConnected) {
    return
  }

  teardownMountedTool()
}

function teardownMountedTool(): void {
  mountedApp?.unmount()
  if (mountContainer?.id === TOOL_HOST_ID) {
    mountContainer.remove()
  }
  mountedApp = null
  mountContainer = null
}

function hideInternalBundleField(): void {
  const bundleField = findBundleField()
  if (!bundleField) {
    return
  }

  hideElementBlock(findBundleFieldWrapper(bundleField) ?? bundleField)
}

function tryActivateEditorSettings(): boolean {
  const settingsButton = findEditorSettingsButton()
  if (!settingsButton || isEditorActionDisabled(settingsButton)) {
    return false
  }

  if (isEditorActionActive(settingsButton)) {
    return true
  }

  settingsButton.click()
  return true
}

function isSettingsTabReady(): boolean {
  const settingsButton = findEditorSettingsButton()
  return Boolean(settingsButton && isEditorActionActive(settingsButton))
}

function isPostEditorPage(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const pathCandidates = [
    window.location.pathname,
    window.location.hash,
    window.location.href,
  ]

  return pathCandidates.some((value) => /\/posts\/editor(?:[/?#]|$)/.test(value))
}

function getEditorRouteKey(): string {
  const search = new URLSearchParams(window.location.search)
  const hash = window.location.hash || ''
  const hashQueryIndex = hash.indexOf('?')
  const hashSearch = hashQueryIndex >= 0 ? hash.slice(hashQueryIndex + 1) : ''

  return [
    window.location.pathname,
    search.get('name') ?? '',
    search.get('postName') ?? '',
    hashSearch,
  ].join('|')
}

function findBundleField(): HTMLInputElement | HTMLTextAreaElement | null {
  const element = document.getElementById(BUNDLE_FIELD_ID)
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element
  }

  if (!element) {
    return null
  }

  const nested = element.querySelector('textarea, input')
  if (nested instanceof HTMLInputElement || nested instanceof HTMLTextAreaElement) {
    return nested
  }

  return null
}

function findBundleFieldWrapper(field: HTMLInputElement | HTMLTextAreaElement): HTMLElement | null {
  if (field instanceof HTMLInputElement && field.type === 'hidden') {
    return null
  }

  return field.closest('.formkit-outer')
    ?? field.closest('.formkit-wrapper')
}

function hideElementBlock(element: HTMLElement): void {
  element.style.display = 'none'
  element.setAttribute('aria-hidden', 'true')
}

function shouldAutoOpenEncryptionPanel(): boolean {
  return new URLSearchParams(window.location.search).get(AUTO_OPEN_QUERY_KEY) === '1'
}

function clearAutoOpenEncryptionFlag(): void {
  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.delete(AUTO_OPEN_QUERY_KEY)
  window.history.replaceState(window.history.state, '', nextUrl.toString())
}
