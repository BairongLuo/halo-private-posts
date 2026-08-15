// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  installOfficialSaveInterceptor,
  POST_SETTING_FORM_ID,
} from './official-save-interceptor'

describe('official Halo save interceptor', () => {
  beforeEach(() => {
    document.body.innerHTML = `<form id="${POST_SETTING_FORM_ID}"></form>`
  })

  it('does not touch an ordinary save when no password change is pending', () => {
    const form = document.getElementById(POST_SETTING_FORM_ID) as HTMLFormElement
    const officialSave = vi.fn((event: Event) => event.preventDefault())
    const prepare = vi.fn(async () => true)
    form.addEventListener('submit', officialSave)
    const uninstall = installOfficialSaveInterceptor(() => false, prepare)

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))

    expect(officialSave).toHaveBeenCalledOnce()
    expect(prepare).not.toHaveBeenCalled()
    uninstall()
  })

  it('prepares the annotation before resuming the official save', async () => {
    const form = document.getElementById(POST_SETTING_FORM_ID) as HTMLFormElement
    const calls: string[] = []
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      calls.push('official-save')
    })
    const uninstall = installOfficialSaveInterceptor(
      () => true,
      async () => {
        calls.push('prepare-password')
        return true
      },
    )

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    await vi.waitFor(() => expect(calls).toEqual(['prepare-password', 'official-save']))
    uninstall()
  })

  it('keeps the official save blocked when password preparation fails', async () => {
    const form = document.getElementById(POST_SETTING_FORM_ID) as HTMLFormElement
    const officialSave = vi.fn((event: Event) => event.preventDefault())
    form.addEventListener('submit', officialSave)
    const uninstall = installOfficialSaveInterceptor(() => true, async () => false)

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(officialSave).not.toHaveBeenCalled()
    uninstall()
  })
})
