import { describe, expect, it } from 'vitest'

function resolveWorkingEncryptionPassword(inputPassword: string, sessionPassword: string): string {
  const normalizedInputPassword = inputPassword.trim()
  if (normalizedInputPassword) {
    return normalizedInputPassword
  }

  return sessionPassword
}

function resolvePendingSaveAction(args: {
  encryptionEnabled: boolean
  hasBundle: boolean
  inputPassword: string
  sessionPassword: string
}): 'none' | 'lock' | 'unlock' | 'refresh' {
  if (!args.encryptionEnabled && args.hasBundle) {
    return 'unlock'
  }

  if (args.encryptionEnabled && !args.hasBundle) {
    return 'lock'
  }

  if (
    args.encryptionEnabled
    && args.hasBundle
    && resolveWorkingEncryptionPassword(args.inputPassword, args.sessionPassword).length > 0
  ) {
    return 'refresh'
  }

  return 'none'
}

describe('annotation save session logic', () => {
  it('treats a remembered session password as refresh-capable', () => {
    expect(resolvePendingSaveAction({
      encryptionEnabled: true,
      hasBundle: true,
      inputPassword: '',
      sessionPassword: 'remembered-secret',
    })).toBe('refresh')
  })

  it('prefers the current input password over the remembered session password', () => {
    expect(resolveWorkingEncryptionPassword(' new-secret ', 'remembered-secret')).toBe('new-secret')
  })

  it('does not refresh when encryption is enabled but no password is available', () => {
    expect(resolvePendingSaveAction({
      encryptionEnabled: true,
      hasBundle: true,
      inputPassword: '',
      sessionPassword: '',
    })).toBe('none')
  })
})
