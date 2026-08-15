// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PASSWORD_CONFIG_FIELD_ID,
  readPasswordConfigField,
  writePasswordConfigField,
} from './annotation-field'

describe('password annotation field', () => {
  beforeEach(() => {
    document.body.innerHTML = `<input id="${PASSWORD_CONFIG_FIELD_ID}" type="hidden" value="old">`
  })

  it('updates the field through the input event observed by FormKit', () => {
    const field = document.getElementById(PASSWORD_CONFIG_FIELD_ID) as HTMLInputElement
    const onInput = vi.fn()
    const onChange = vi.fn()
    field.addEventListener('input', onInput)
    field.addEventListener('change', onChange)

    expect(writePasswordConfigField('{"hash":"new"}')).toBe(true)
    expect(readPasswordConfigField()).toBe('{"hash":"new"}')
    expect(onInput).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('reports when the official annotation field is not mounted', () => {
    document.body.innerHTML = ''
    expect(writePasswordConfigField('value')).toBe(false)
  })
})
