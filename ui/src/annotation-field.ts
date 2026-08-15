export const PASSWORD_CONFIG_FIELD_ID = 'hpp-hide-password-config'

export function findPasswordConfigField(): HTMLInputElement | null {
  const element = document.getElementById(PASSWORD_CONFIG_FIELD_ID)
  if (element instanceof HTMLInputElement) {
    return element
  }
  const nested = element?.querySelector('input')
  return nested instanceof HTMLInputElement ? nested : null
}

export function readPasswordConfigField(): string {
  return findPasswordConfigField()?.value?.trim() ?? ''
}

/**
 * 通过原生 input 事件让 FormKit 更新它的响应式表单状态。
 * 仅修改 DOM value 会在下一次渲染时被 FormKit 回滚。
 */
export function writePasswordConfigField(value: string): boolean {
  const field = findPasswordConfigField()
  if (!field) {
    return false
  }

  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (valueSetter) {
    valueSetter.call(field, value)
  } else {
    field.value = value
  }
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}
