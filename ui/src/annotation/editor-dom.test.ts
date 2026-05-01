// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { findEditorEntryAnchor, findEditorSaveButton, findEditorSettingsButton } from './editor-dom'

describe('editor-dom helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('finds the best editor entry anchor from the current toolbar', () => {
    document.body.innerHTML = `
      <div class="legacy-toolbar">
        <button>Settings</button>
      </div>
      <div class="editor-toolbar">
        <button>Preview</button>
        <button>Add Cover</button>
      </div>
    `

    const anchor = findEditorEntryAnchor()

    expect(anchor?.textContent).toBe('Add Cover')
  })

  it('prefers an enabled save button over a disabled one', () => {
    document.body.innerHTML = `
      <div class="editor-toolbar">
        <button disabled>Save</button>
        <button>Publish</button>
        <button class="toolbar-button">Save</button>
      </div>
    `

    const saveButton = findEditorSaveButton()

    expect(saveButton?.textContent).toBe('Save')
    expect(saveButton?.hasAttribute('disabled')).toBe(false)
  })

  it('supports localized save labels', () => {
    document.body.innerHTML = `
      <div class="editor-toolbar">
        <button>发布</button>
        <button>保存</button>
      </div>
    `

    const saveButton = findEditorSaveButton()

    expect(saveButton?.textContent).toBe('保存')
  })

  it('finds the editor settings action from tabs', () => {
    document.body.innerHTML = `
      <div class="editor-toolbar">
        <div class="tabbar-item" role="tab">Outline</div>
        <div class="tabbar-item is-active" role="tab">Settings</div>
      </div>
    `

    const settingsButton = findEditorSettingsButton()

    expect(settingsButton?.textContent).toBe('Settings')
  })
})
