import type { LocalRecoverySecretState } from '@/utils/recovery-phrase'
import { RECOVERY_MNEMONIC_SCHEME } from '@/utils/recovery-phrase'

const STORAGE_KEY = 'halo-private-posts.local-recovery-secret'

export function getLocalRecoverySecretState(): LocalRecoverySecretState | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return isLocalRecoverySecretState(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function hasLocalRecoverySecretState(): boolean {
  return Boolean(getLocalRecoverySecretState())
}

export function saveLocalRecoverySecretState(state: LocalRecoverySecretState): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearLocalRecoverySecretState(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }

  window.localStorage.removeItem(STORAGE_KEY)
}

function isLocalRecoverySecretState(value: unknown): value is LocalRecoverySecretState {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const state = value as Record<string, unknown>
  return state.scheme === RECOVERY_MNEMONIC_SCHEME
    && typeof state.entropyHex === 'string'
    && typeof state.createdAt === 'string'
}
