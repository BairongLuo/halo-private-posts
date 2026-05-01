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

import { syncPrivatePostAnnotationMount } from './mount'

describe('annotation mount helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.history.replaceState({}, '', '/console/')
    createAppMock.mockClear()
    mountMock.mockClear()
    unmountMock.mockClear()
    vi.restoreAllMocks()
  })

  it('mounts the annotation tool inside the settings slot', () => {
    window.history.replaceState({}, '', '/console/posts/editor?name=demo-post')
    document.body.innerHTML = `
      <div class="editor-toolbar">
        <button class="toolbar-button">Settings</button>
      </div>
      <div data-hpp-annotation-tool-slot="true" id="annotation-slot"></div>
    `

    syncPrivatePostAnnotationMount()

    const slot = document.getElementById('annotation-slot')

    expect(createAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'PrivatePostAnnotationTool',
      }),
      {
        bundleFieldId: 'hpp-annotation-bundle',
        mountSelector: '[data-hpp-annotation-tool-slot]',
      }
    )
    expect(mountMock).toHaveBeenCalledWith(expect.any(HTMLElement))
    const host = document.getElementById('hpp-annotation-tool-host')
    expect(host).not.toBeNull()
    expect(host?.parentElement).toBe(document.body)
    expect(slot).not.toBeNull()
  })

  it('clicks Settings when the editor is opened from the list status tag', () => {
    window.history.replaceState(
      {},
      '',
      '/console/posts/editor?name=demo-post&hppOpenEncryption=1'
    )
    document.body.innerHTML = `
      <div class="editor-toolbar tabs-wrapper">
        <div class="tabbar-item" role="tab">Outline</div>
        <div class="tabbar-item" role="tab">Settings</div>
      </div>
    `

    const settingsButton = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
      .find((element) => element.textContent === 'Settings')
    const clickHandler = vi.fn()
    settingsButton?.addEventListener('click', clickHandler)

    syncPrivatePostAnnotationMount()

    expect(clickHandler).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('?name=demo-post')
  })

  it('hides the internal bundle field wrapper in settings', () => {
    window.history.replaceState({}, '', '/console/posts/editor?name=demo-post')
    document.body.innerHTML = `
      <div data-hpp-annotation-tool-slot="true"></div>
      <div class="formkit-outer" id="internal-wrapper">
        <textarea id="hpp-annotation-bundle"></textarea>
      </div>
    `

    syncPrivatePostAnnotationMount()

    const wrapper = document.getElementById('internal-wrapper')

    expect(wrapper?.style.display).toBe('none')
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true')
  })
})
