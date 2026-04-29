// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAppMock, mountMock, unmountMock } = vi.hoisted(() => {
  const mountMock = vi.fn()
  const unmountMock = vi.fn()
  const createAppMock = vi.fn(() => ({
    mount: mountMock,
    unmount: unmountMock,
  }))

  return {
    createAppMock,
    mountMock,
    unmountMock,
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
  hideInternalAnnotationFields,
  openPrivatePostAnnotationTool,
  syncPrivatePostEditorEntry,
} from './mount'

describe('annotation mount helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/console/')
    createAppMock.mockClear()
    mountMock.mockClear()
    unmountMock.mockClear()
    vi.restoreAllMocks()
  })

  it('injects a single sibling entry next to the current editor toolbar anchor', () => {
    window.history.replaceState({}, '', '/console/posts/editor?name=demo-post')
    document.body.innerHTML = `
      <div class="editor-toolbar">
        <button class="toolbar-button">Preview</button>
        <button class="toolbar-button">Settings</button>
        <button class="toolbar-button">Add Cover</button>
      </div>
    `

    syncPrivatePostEditorEntry()
    syncPrivatePostEditorEntry()

    const anchorButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Add Cover')
    const injectedEntries = Array.from(document.querySelectorAll<HTMLButtonElement>(
      '[data-hpp-editor-encryption-entry]'
    ))

    expect(anchorButton).not.toBeNull()
    expect(injectedEntries).toHaveLength(1)
    expect(injectedEntries[0].textContent).toBe('文章加密')
    expect(injectedEntries[0].className).toBe('toolbar-button')
    expect(injectedEntries[0].previousElementSibling).toBe(anchorButton)
  })

  it('falls back to a non-button Settings tab when no current toolbar anchor exists', () => {
    window.history.replaceState({}, '', '/console/posts/editor?name=demo-post')
    document.body.innerHTML = `
      <div class="editor-toolbar tabs-wrapper">
        <div class="tabbar-item">Outline</div>
        <div class="tabbar-item" role="tab">Settings</div>
      </div>
    `

    syncPrivatePostEditorEntry()

    const settingsEntry = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"], .tabbar-item'))
      .find((element) => element.textContent === 'Settings')
    const injectedEntry = document.querySelector<HTMLElement>('[data-hpp-editor-encryption-entry]')

    expect(settingsEntry).not.toBeNull()
    expect(injectedEntry).not.toBeNull()
    expect(injectedEntry?.textContent).toBe('文章加密')
    expect(injectedEntry?.tagName).toBe('DIV')
    expect(injectedEntry?.getAttribute('role')).toBe('button')
    expect(injectedEntry?.previousElementSibling).toBe(settingsEntry)
  })

  it('opens an independent encryption panel without clicking Settings', async () => {
    window.history.replaceState({}, '', '/console/posts/editor?name=demo-post')
    document.body.innerHTML = `
      <div class="editor-toolbar">
        <button class="toolbar-button">Preview</button>
        <button class="toolbar-button">Settings</button>
      </div>
    `

    syncPrivatePostEditorEntry()

    const settingsButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Settings')
    const settingsClickHandler = vi.fn()
    settingsButton?.addEventListener('click', settingsClickHandler)

    const opened = await openPrivatePostAnnotationTool()
    const shell = document.querySelector<HTMLElement>('[data-hpp-standalone-shell]')
    const panel = document.querySelector<HTMLElement>('[data-hpp-standalone-content]')

    expect(opened).toBe(true)
    expect(settingsClickHandler).not.toHaveBeenCalled()
    expect(shell).not.toBeNull()
    expect(shell?.hidden).toBe(false)
    expect(panel).not.toBeNull()
    expect(createAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'PrivatePostAnnotationTool',
      }),
      {
        bundleFieldId: 'hpp-annotation-bundle',
        standalone: true,
      }
    )
    expect(mountMock).toHaveBeenCalledWith(panel)
  })

  it('hides the internal annotation hook and bundle field wrapper inside Settings', () => {
    document.body.innerHTML = `
      <div class="formkit-outer" id="internal-wrapper">
        <textarea id="hpp-annotation-bundle"></textarea>
      </div>
      <div data-hpp-annotation-internal="true" id="internal-hook">internal</div>
    `

    hideInternalAnnotationFields()

    const wrapper = document.getElementById('internal-wrapper')
    const hook = document.getElementById('internal-hook')

    expect(wrapper?.style.display).toBe('none')
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true')
    expect(hook?.style.display).toBe('none')
    expect(hook?.getAttribute('aria-hidden')).toBe('true')
  })
})
