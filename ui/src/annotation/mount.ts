import { createApp } from 'vue'

import PrivatePostAnnotationTool from './PrivatePostAnnotationTool.vue'

const TOOL_SELECTOR = '[data-hpp-annotation-tool]'
const TOOL_PANEL_SELECTOR = '[data-hpp-annotation-panel]'
const EDITOR_ENTRY_SELECTOR = '[data-hpp-editor-encryption-entry]'
const TOOL_ENTRY_LABEL = '文章加密'
const SETTINGS_LABELS = ['Settings', '设置']
const ANNOTATIONS_LABELS = ['Annotations', '注解']
const TOOL_WAIT_INTERVAL_MS = 120
const TOOL_WAIT_ATTEMPTS = 20
const TOOL_ATTENTION_TIMEOUT_MS = 2200

let installed = false
const attentionTimeouts = new WeakMap<HTMLElement, number>()

export function installPrivatePostAnnotationTool(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  installed = true

  const mountAll = () => {
    mountPrivatePostAnnotationTools()
    syncPrivatePostEditorEntry()
  }

  mountAll()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll, { once: true })
  }

  const observer = new MutationObserver(() => {
    mountAll()
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

export function mountPrivatePostAnnotationTools(): void {
  document.querySelectorAll<HTMLElement>(TOOL_SELECTOR).forEach((container) => {
    if (container.dataset.hppMounted === 'true') {
      return
    }

    const bundleFieldId = container.dataset.bundleFieldId ?? 'hpp-annotation-bundle'

    createApp(PrivatePostAnnotationTool, {
      bundleFieldId,
    }).mount(container)

    container.dataset.hppMounted = 'true'
  })
}

export function syncPrivatePostEditorEntry(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const existingEntries = Array.from(document.querySelectorAll<HTMLElement>(EDITOR_ENTRY_SELECTOR))

  if (!isPostEditorPage()) {
    existingEntries.forEach((entry) => entry.remove())
    return
  }

  const settingsButton = findEditorSettingsButton()
  if (!settingsButton) {
    return
  }

  const reusableEntry = existingEntries[0] instanceof HTMLButtonElement
    ? existingEntries[0]
    : document.createElement('button')

  existingEntries
    .slice(reusableEntry === existingEntries[0] ? 1 : 0)
    .forEach((entry) => entry.remove())

  configureEditorEntry(reusableEntry, settingsButton)

  if (
    reusableEntry.parentElement !== settingsButton.parentElement
    || reusableEntry.previousElementSibling !== settingsButton
  ) {
    settingsButton.insertAdjacentElement('afterend', reusableEntry)
  }
}

export async function openPrivatePostAnnotationTool(): Promise<boolean> {
  const existingPanel = findReachableAnnotationPanel()
  if (existingPanel) {
    focusAnnotationPanel(existingPanel)
    return true
  }

  const annotationsTrigger = findLabeledElement(ANNOTATIONS_LABELS)
  if (annotationsTrigger) {
    annotationsTrigger.click()
    const panelAfterTabSwitch = await waitForAnnotationPanel()
    if (panelAfterTabSwitch) {
      focusAnnotationPanel(panelAfterTabSwitch)
      return true
    }
  }

  const settingsButton = findEditorSettingsButton()
  if (!settingsButton) {
    return false
  }

  settingsButton.click()

  let panel = await waitForAnnotationPanel()
  if (!panel) {
    const annotationsTriggerAfterOpen = findLabeledElement(ANNOTATIONS_LABELS)
    if (annotationsTriggerAfterOpen) {
      annotationsTriggerAfterOpen.click()
      panel = await waitForAnnotationPanel()
    }
  }

  if (!panel) {
    return false
  }

  focusAnnotationPanel(panel)
  return true
}

function configureEditorEntry(entry: HTMLButtonElement, settingsButton: HTMLElement): void {
  entry.type = 'button'
  entry.className = settingsButton.className
  entry.textContent = TOOL_ENTRY_LABEL
  entry.title = TOOL_ENTRY_LABEL
  entry.disabled = false
  entry.setAttribute('data-hpp-editor-encryption-entry', 'true')
  entry.onclick = () => {
    void handleEditorEntryClick(entry)
  }
}

async function handleEditorEntryClick(entry: HTMLButtonElement): Promise<void> {
  if (entry.dataset.hppBusy === 'true') {
    return
  }

  entry.dataset.hppBusy = 'true'
  const wasDisabled = entry.disabled
  entry.disabled = true

  try {
    await openPrivatePostAnnotationTool()
  } finally {
    entry.disabled = wasDisabled
    delete entry.dataset.hppBusy
  }
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

function findEditorSettingsButton(): HTMLElement | null {
  return findLabeledElement(SETTINGS_LABELS)
}

function findLabeledElement(labels: string[]): HTMLElement | null {
  const expectedLabels = new Set(labels.map((label) => normalizeText(label)))
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    'button, [role="button"], [role="tab"], .tabbar-item'
  ))

  const matched = candidates
    .filter((element) => !element.matches(EDITOR_ENTRY_SELECTOR))
    .filter((element) => expectedLabels.has(readElementLabel(element)))
    .sort((left, right) => scoreLabeledElement(right) - scoreLabeledElement(left))

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

function scoreLabeledElement(element: HTMLElement): number {
  let score = isReachableElement(element) ? 10 : 0

  if (element.tagName === 'BUTTON') {
    score += 4
  }

  const context = collectAncestorClassNames(element)
  if (/\beditor\b/i.test(context)) {
    score += 2
  }
  if (/\btab\b/i.test(context) || /\btabs\b/i.test(context) || /\btabbar\b/i.test(context)) {
    score += 1
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

async function waitForAnnotationPanel(): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < TOOL_WAIT_ATTEMPTS; attempt += 1) {
    const panel = findReachableAnnotationPanel()
    if (panel) {
      return panel
    }

    await sleep(TOOL_WAIT_INTERVAL_MS)
  }

  return findReachableAnnotationPanel()
}

function findReachableAnnotationPanel(): HTMLElement | null {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(TOOL_PANEL_SELECTOR),
    ...document.querySelectorAll<HTMLElement>(TOOL_SELECTOR),
  ]

  return candidates.find((candidate) => isReachableElement(candidate)) ?? null
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

function focusAnnotationPanel(target: HTMLElement): void {
  target.scrollIntoView?.({
    behavior: 'smooth',
    block: 'start',
    inline: 'nearest',
  })

  const previousTimeout = attentionTimeouts.get(target)
  if (previousTimeout) {
    window.clearTimeout(previousTimeout)
  }

  target.dataset.hppAttention = 'true'
  const timeoutId = window.setTimeout(() => {
    delete target.dataset.hppAttention
    attentionTimeouts.delete(target)
  }, TOOL_ATTENTION_TIMEOUT_MS)
  attentionTimeouts.set(target, timeoutId)
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}
