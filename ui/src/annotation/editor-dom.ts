const EDITOR_ENTRY_ANCHOR_LABELS = [
  ['Add Cover', '添加封面'],
  ['Publish', '发布'],
  ['Save', '保存'],
  ['Preview', '预览'],
  ['Settings', '设置'],
] as const

const EDITOR_SAVE_LABELS = ['Save', '保存', 'Update', '更新'] as const
const EDITOR_SETTINGS_LABELS = ['Settings', '设置'] as const
const EDITOR_ACTION_SELECTOR = 'button, [role="button"], [role="tab"], .tabbar-item, .toolbar-item, a'

interface FindEditorElementOptions {
  root?: ParentNode
  excludeSelector?: string
}

export function findEditorEntryAnchor(options: FindEditorElementOptions = {}): HTMLElement | null {
  for (const labels of EDITOR_ENTRY_ANCHOR_LABELS) {
    const matched = findBestLabeledElement(labels, options, false)
    if (matched) {
      return matched
    }
  }

  return null
}

export function findEditorSaveButton(options: FindEditorElementOptions = {}): HTMLElement | null {
  return findBestLabeledElement(EDITOR_SAVE_LABELS, options, true)
}

export function findEditorSettingsButton(options: FindEditorElementOptions = {}): HTMLElement | null {
  return findBestLabeledElement(EDITOR_SETTINGS_LABELS, options, true)
}

export function isEditorActionDisabled(element: HTMLElement): boolean {
  if (
    (element instanceof HTMLButtonElement || element instanceof HTMLInputElement)
    && element.disabled
  ) {
    return true
  }

  if (element.getAttribute('aria-disabled') === 'true') {
    return true
  }

  const classContext = collectAncestorClassNames(element)
  if (/\b(disabled|is-disabled|btn-disabled)\b/i.test(classContext)) {
    return true
  }

  const computedStyle = window.getComputedStyle?.(element)
  return computedStyle?.pointerEvents === 'none'
}

export function isEditorActionActive(element: HTMLElement): boolean {
  if (element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-pressed') === 'true') {
    return true
  }

  if (element.getAttribute('data-state') === 'active') {
    return true
  }

  const classContext = collectAncestorClassNames(element)
  return /\b(active|current|selected|is-active|is-selected)\b/i.test(classContext)
}

function findBestLabeledElement(
  labels: readonly string[],
  options: FindEditorElementOptions,
  preferEnabled: boolean
): HTMLElement | null {
  const expectedLabels = new Set(labels.map((label) => normalizeText(label)))
  const root = options.root ?? document
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(EDITOR_ACTION_SELECTOR))

  const matched = candidates
    .filter((element) => !options.excludeSelector || !element.matches(options.excludeSelector))
    .filter((element) => expectedLabels.has(readElementLabel(element)))
    .sort((left, right) => scoreElement(right, preferEnabled) - scoreElement(left, preferEnabled))

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

function scoreElement(element: HTMLElement, preferEnabled: boolean): number {
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

  if (preferEnabled) {
    score += isEditorActionDisabled(element) ? -8 : 4
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}
