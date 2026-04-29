// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAppMock, mountMock } = vi.hoisted(() => {
  const mountMock = vi.fn()
  const createAppMock = vi.fn(() => ({
    mount: mountMock,
  }))

  return {
    createAppMock,
    mountMock,
  }
})

vi.mock('vue', () => ({
  createApp: createAppMock,
}))

vi.mock('./PrivatePostAnnotationTool.vue', () => ({
  default: {
    name: 'PrivatePostAnnotationTool',
  },
}))

import {
  mountPrivatePostAnnotationTools,
  openPrivatePostAnnotationTool,
  syncPrivatePostEditorEntry,
} from './mount'

describe('annotation mount helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/console/')
    createAppMock.mockClear()
    mountMock.mockClear()
    vi.restoreAllMocks()
    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('mounts annotation containers only once', () => {
    document.body.innerHTML = `
      <div data-hpp-annotation-tool="true" data-bundle-field-id="bundle-one"></div>
    `

    const container = document.querySelector<HTMLElement>('[data-hpp-annotation-tool]')

    expect(container).not.toBeNull()

    mountPrivatePostAnnotationTools()

    expect(createAppMock).toHaveBeenCalledTimes(1)
    expect(createAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'PrivatePostAnnotationTool',
      }),
      {
        bundleFieldId: 'bundle-one',
      }
    )
    expect(mountMock).toHaveBeenCalledWith(container)
    expect(container?.dataset.hppMounted).toBe('true')

    mountPrivatePostAnnotationTools()

    expect(createAppMock).toHaveBeenCalledTimes(1)
  })

  it('injects a single sibling entry next to the Settings button on post editor pages', () => {
    window.history.replaceState({}, '', '/console/posts/editor?name=demo-post')
    document.body.innerHTML = `
      <div class="editor-toolbar">
        <button class="toolbar-button">Preview</button>
        <button class="toolbar-button">Settings</button>
      </div>
    `

    syncPrivatePostEditorEntry()
    syncPrivatePostEditorEntry()

    const settingsButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Settings')
    const injectedEntries = Array.from(document.querySelectorAll<HTMLButtonElement>(
      '[data-hpp-editor-encryption-entry]'
    ))

    expect(settingsButton).not.toBeNull()
    expect(injectedEntries).toHaveLength(1)
    expect(injectedEntries[0].textContent).toBe('文章加密')
    expect(injectedEntries[0].className).toBe('toolbar-button')
    expect(injectedEntries[0].previousElementSibling).toBe(settingsButton)
  })

  it('opens the settings drawer via the injected flow and focuses the annotation panel', async () => {
    window.history.replaceState({}, '', '/console/posts/editor?name=demo-post')
    document.body.innerHTML = `
      <div class="editor-toolbar">
        <button class="toolbar-button">Preview</button>
        <button class="toolbar-button">Settings</button>
      </div>
    `

    const settingsButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Settings')
    const settingsClickHandler = vi.fn(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<section data-hpp-annotation-panel="true"></section>'
      )
    })
    settingsButton?.addEventListener('click', settingsClickHandler)

    const opened = await openPrivatePostAnnotationTool()
    const panel = document.querySelector<HTMLElement>('[data-hpp-annotation-panel]')

    expect(opened).toBe(true)
    expect(settingsClickHandler).toHaveBeenCalledTimes(1)
    expect(panel).not.toBeNull()
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    expect(panel?.dataset.hppAttention).toBe('true')
  })
})
