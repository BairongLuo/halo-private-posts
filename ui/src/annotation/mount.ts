import { createApp, type App } from 'vue'

import PrivatePostAnnotationTool from './PrivatePostAnnotationTool.vue'

const INTERNAL_BUNDLE_FIELD_ID = 'hpp-annotation-bundle'
const EDITOR_ENTRY_SELECTOR = '[data-hpp-editor-encryption-entry]'
const INTERNAL_HOOK_SELECTOR = '[data-hpp-annotation-internal]'
const STANDALONE_SHELL_SELECTOR = '[data-hpp-standalone-shell]'
const STANDALONE_CONTENT_SELECTOR = '[data-hpp-standalone-content]'
const STANDALONE_BACKDROP_SELECTOR = '[data-hpp-standalone-backdrop]'
const STANDALONE_CLOSE_SELECTOR = '[data-hpp-standalone-close]'
const STANDALONE_STYLE_ID = 'hpp-standalone-shell-style'
const TOOL_ENTRY_LABEL = '文章加密'
const EDITOR_ENTRY_ANCHOR_LABELS = [
  ['Add Cover', '添加封面'],
  ['Publish', '发布'],
  ['Save', '保存'],
  ['Preview', '预览'],
  ['Settings', '设置'],
] as const

let installed = false
let standaloneApp: App<Element> | null = null
let standaloneShell: HTMLElement | null = null
let standaloneContent: HTMLElement | null = null
let lastEditorRouteKey = ''
let scheduledSyncFrame: number | null = null

export function installPrivatePostAnnotationTool(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  installed = true

  const syncAll = () => {
    scheduledSyncFrame = null
    hideInternalAnnotationFields()
    syncPrivatePostEditorEntry()
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
  document.addEventListener('keydown', handleGlobalKeydown)
}

export function syncPrivatePostEditorEntry(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const existingEntries = Array.from(document.querySelectorAll<HTMLElement>(EDITOR_ENTRY_SELECTOR))

  if (!isPostEditorPage()) {
    existingEntries.forEach((entry) => entry.remove())
    lastEditorRouteKey = ''
    closeStandaloneEncryptionPanel({ unmount: true })
    return
  }

  const routeKey = getEditorRouteKey()
  if (routeKey !== lastEditorRouteKey) {
    lastEditorRouteKey = routeKey
    closeStandaloneEncryptionPanel({ unmount: true })
  }

  const anchorElement = findEditorEntryAnchor()
  if (!anchorElement) {
    return
  }

  const reusableEntry = existingEntries[0] ?? createEditorEntryElement(anchorElement)

  existingEntries
    .slice(reusableEntry === existingEntries[0] ? 1 : 0)
    .forEach((entry) => entry.remove())

  configureEditorEntry(reusableEntry, anchorElement)

  if (
    reusableEntry.parentElement !== anchorElement.parentElement
    || reusableEntry.previousElementSibling !== anchorElement
  ) {
    anchorElement.insertAdjacentElement('afterend', reusableEntry)
  }
}

export async function openPrivatePostAnnotationTool(): Promise<boolean> {
  if (!isPostEditorPage()) {
    return false
  }

  const shell = ensureStandaloneShell()
  const content = ensureStandaloneShellContent(shell)

  mountStandaloneTool(content)

  shell.hidden = false
  shell.dataset.open = 'true'

  const closeButton = shell.querySelector<HTMLElement>(STANDALONE_CLOSE_SELECTOR)
  closeButton?.focus()

  return true
}

export function hideInternalAnnotationFields(): void {
  const bundleField = findBundleField()
  if (bundleField) {
    hideElementBlock(findBundleFieldWrapper(bundleField) ?? bundleField)
  }

  document.querySelectorAll<HTMLElement>(INTERNAL_HOOK_SELECTOR).forEach((element) => {
    hideElementBlock(element)
  })
}

function createEditorEntryElement(anchorElement: HTMLElement): HTMLElement {
  const tagName = anchorElement.tagName.toLowerCase()

  if (tagName === 'button') {
    return document.createElement('button')
  }

  return document.createElement(tagName || 'div')
}

function configureEditorEntry(entry: HTMLElement, anchorElement: HTMLElement): void {
  if (entry instanceof HTMLButtonElement) {
    entry.type = 'button'
    entry.disabled = false
  } else {
    entry.setAttribute('role', 'button')
    entry.tabIndex = 0
    entry.removeAttribute('disabled')
    entry.removeAttribute('aria-disabled')
    entry.onkeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        void openPrivatePostAnnotationTool()
      }
    }
  }

  entry.className = anchorElement.className
  entry.textContent = TOOL_ENTRY_LABEL
  entry.title = TOOL_ENTRY_LABEL
  entry.setAttribute('data-hpp-editor-encryption-entry', 'true')
  entry.onclick = () => {
    void openPrivatePostAnnotationTool()
  }
}

function mountStandaloneTool(container: HTMLElement): void {
  if (standaloneApp && standaloneContent === container) {
    return
  }

  teardownStandaloneTool()

  standaloneApp = createApp(PrivatePostAnnotationTool, {
    bundleFieldId: INTERNAL_BUNDLE_FIELD_ID,
    standalone: true,
  })
  standaloneApp.mount(container)
  standaloneContent = container
}

function teardownStandaloneTool(): void {
  standaloneApp?.unmount()
  standaloneApp = null

  if (standaloneContent) {
    standaloneContent.innerHTML = ''
  }
  standaloneContent = null
}

function closeStandaloneEncryptionPanel(options: { unmount: boolean }): void {
  if (!standaloneShell) {
    if (options.unmount) {
      teardownStandaloneTool()
    }
    return
  }

  delete standaloneShell.dataset.open
  standaloneShell.hidden = true

  if (options.unmount) {
    teardownStandaloneTool()
  }
}

function ensureStandaloneShell(): HTMLElement {
  ensureStandaloneShellStyles()

  if (standaloneShell?.isConnected) {
    return standaloneShell
  }

  standaloneShell = document.createElement('div')
  standaloneShell.hidden = true
  standaloneShell.setAttribute('data-hpp-standalone-shell', 'true')
  standaloneShell.innerHTML = `
    <div data-hpp-standalone-backdrop="true"></div>
    <aside data-hpp-standalone-panel="true" role="dialog" aria-modal="true" aria-label="文章加密">
      <header data-hpp-standalone-header="true">
        <div data-hpp-standalone-title="true">
          <p>文章加密</p>
          <span>独立于 Settings 的编辑页加密面板</span>
        </div>
        <button type="button" data-hpp-standalone-close="true" aria-label="关闭文章加密面板">
          关闭
        </button>
      </header>
      <div data-hpp-standalone-content="true"></div>
    </aside>
  `

  standaloneShell.querySelector<HTMLElement>(STANDALONE_BACKDROP_SELECTOR)?.addEventListener('click', () => {
    closeStandaloneEncryptionPanel({ unmount: true })
  })
  standaloneShell.querySelector<HTMLElement>(STANDALONE_CLOSE_SELECTOR)?.addEventListener('click', () => {
    closeStandaloneEncryptionPanel({ unmount: true })
  })

  document.body.appendChild(standaloneShell)
  return standaloneShell
}

function ensureStandaloneShellContent(shell: HTMLElement): HTMLElement {
  const content = shell.querySelector<HTMLElement>(STANDALONE_CONTENT_SELECTOR)
  if (!content) {
    throw new Error('独立文章加密面板挂载点缺失')
  }

  return content
}

function ensureStandaloneShellStyles(): void {
  if (document.getElementById(STANDALONE_STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = STANDALONE_STYLE_ID
  style.textContent = `
    ${STANDALONE_SHELL_SELECTOR} {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
    }

    ${STANDALONE_SHELL_SELECTOR}[hidden] {
      display: none !important;
    }

    ${STANDALONE_BACKDROP_SELECTOR} {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(2px);
    }

    ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-panel] {
      position: absolute;
      top: 0;
      right: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      width: min(460px, 100vw);
      height: 100%;
      background: linear-gradient(180deg, #f8fafc 0%, #eef6ff 100%);
      box-shadow: -24px 0 60px rgba(15, 23, 42, 0.2);
      border-left: 1px solid rgba(148, 163, 184, 0.35);
    }

    ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-header] {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 18px 14px;
      border-bottom: 1px solid rgba(203, 213, 225, 0.9);
      background: rgba(255, 255, 255, 0.82);
      backdrop-filter: blur(10px);
    }

    ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-title] > p {
      margin: 0;
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
    }

    ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-title] > span {
      display: block;
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.5;
      color: #64748b;
    }

    ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-close] {
      border: 0;
      border-radius: 999px;
      background: #e2e8f0;
      color: #0f172a;
      font-size: 12px;
      font-weight: 700;
      padding: 8px 12px;
      cursor: pointer;
    }

    ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-content] {
      overflow: auto;
      padding: 18px;
    }

    @media (max-width: 640px) {
      ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-panel] {
        width: 100vw;
      }

      ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-header] {
        padding: 16px 14px 12px;
      }

      ${STANDALONE_SHELL_SELECTOR} [data-hpp-standalone-content] {
        padding: 14px;
      }
    }
  `

  document.head.appendChild(style)
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !standaloneShell || standaloneShell.hidden) {
    return
  }

  closeStandaloneEncryptionPanel({ unmount: true })
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

function findEditorEntryAnchor(): HTMLElement | null {
  for (const labels of EDITOR_ENTRY_ANCHOR_LABELS) {
    const matched = findLabeledElement(labels)
    if (matched) {
      return matched
    }
  }

  return null
}

function findLabeledElement(labels: readonly string[]): HTMLElement | null {
  const expectedLabels = new Set(labels.map((label) => normalizeText(label)))
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    'button, [role="button"], [role="tab"], .tabbar-item, .toolbar-item, a'
  ))

  const matched = candidates
    .filter((element) => !element.matches(EDITOR_ENTRY_SELECTOR))
    .filter((element) => expectedLabels.has(readElementLabel(element)))
    .sort((left, right) => scoreElement(right) - scoreElement(left))

  return matched[0] ?? null
}

function readElementLabel(element: HTMLElement): string {
  const labelCandidates = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.textContent,
  ]

  for (const candidate of labelCandidates) {
    if (!candidate) {
      continue
    }

    const normalized = normalizeText(candidate)
    if (normalized) {
      return normalized
    }
  }

  return ''
}

function scoreElement(element: HTMLElement): number {
  let score = 0

  if (element.tagName === 'BUTTON') {
    score += 3
  }

  const classContext = collectAncestorClassNames(element)
  if (/\beditor\b/i.test(classContext)) {
    score += 2
  }

  if (isReachableElement(element)) {
    score += 10
  }

  return score
}

function collectAncestorClassNames(element: HTMLElement): string {
  const classNames: string[] = []
  let current: HTMLElement | null = element

  while (current) {
    if (typeof current.className === 'string' && current.className.trim().length > 0) {
      classNames.push(current.className)
    }
    current = current.parentElement
  }

  return classNames.join(' ')
}

function isReachableElement(element: HTMLElement): boolean {
  let current: HTMLElement | null = element

  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') {
      return false
    }

    const computedStyle = window.getComputedStyle?.(current)
    if (computedStyle?.display === 'none' || computedStyle?.visibility === 'hidden') {
      return false
    }

    current = current.parentElement
  }

  return true
}

function findBundleField(): HTMLInputElement | HTMLTextAreaElement | null {
  const element = document.getElementById(INTERNAL_BUNDLE_FIELD_ID)
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
  return field.closest('.formkit-outer')
    ?? field.closest('.formkit-wrapper')
    ?? field.parentElement
}

function hideElementBlock(element: HTMLElement): void {
  element.style.display = 'none'
  element.setAttribute('aria-hidden', 'true')
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}
