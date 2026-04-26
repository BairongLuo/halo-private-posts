import { Buffer } from 'buffer'
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
  wordlists,
} from 'bip39'

export const RECOVERY_MNEMONIC_SCHEME = 'mnemonic-v1'
export const RECOVERY_KEY_WRAP_ALGORITHM = 'aes-256-gcm'

const RECOVERY_DERIVATION_INFO = 'halo-private-posts/recovery/v1'
const RECOVERY_ENTROPY_BYTES = 16
const RECOVERY_KEY_BYTES = 32

const globalWithBuffer = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
}

if (!globalWithBuffer.Buffer) {
  globalWithBuffer.Buffer = Buffer
}

export interface LocalRecoverySecretState {
  scheme: typeof RECOVERY_MNEMONIC_SCHEME
  entropyHex: string
  createdAt: string
}

export async function createRecoveryMnemonicSetup(): Promise<{
  mnemonic: string
  state: LocalRecoverySecretState
}> {
  const cryptoObject = globalThis.crypto
  if (!cryptoObject?.getRandomValues) {
    throw new Error('当前环境不支持安全随机数生成')
  }

  const entropy = cryptoObject.getRandomValues(new Uint8Array(RECOVERY_ENTROPY_BYTES))
  const entropyHex = bytesToHex(entropy)

  return {
    mnemonic: entropyToMnemonic(entropyHex, wordlists.english),
    state: {
      scheme: RECOVERY_MNEMONIC_SCHEME,
      entropyHex,
      createdAt: new Date().toISOString(),
    },
  }
}

export function normalizeRecoveryMnemonic(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((item) => item.length > 0)
    .join(' ')
}

export function getRecoveryMnemonicWords(mnemonic: string): string[] {
  const normalized = normalizeRecoveryMnemonic(mnemonic)
  return normalized ? normalized.split(' ') : []
}

export async function importRecoveryMnemonic(mnemonic: string): Promise<LocalRecoverySecretState> {
  const normalized = normalizeRecoveryMnemonic(mnemonic)
  if (!normalized) {
    throw new Error('恢复助记词不能为空')
  }

  if (!validateMnemonic(normalized, wordlists.english)) {
    throw new Error('恢复助记词无效')
  }

  return {
    scheme: RECOVERY_MNEMONIC_SCHEME,
    entropyHex: mnemonicToEntropy(normalized, wordlists.english),
    createdAt: new Date().toISOString(),
  }
}

export async function deriveRecoveryKeyFromMnemonic(mnemonic: string): Promise<Uint8Array> {
  const state = await importRecoveryMnemonic(mnemonic)
  return await deriveRecoveryKeyFromState(state)
}

export async function deriveRecoveryKeyFromState(
  state: LocalRecoverySecretState
): Promise<Uint8Array> {
  if (state.scheme !== RECOVERY_MNEMONIC_SCHEME) {
    throw new Error(`不支持的恢复助记词方案：${state.scheme}`)
  }

  const cryptoApi = globalThis.crypto?.subtle
  if (!cryptoApi) {
    throw new Error('当前环境不支持 Web Crypto API')
  }

  const entropyBytes = hexToBytes(state.entropyHex)
  const keyMaterial = await cryptoApi.importKey(
    'raw',
    entropyBytes,
    'HKDF',
    false,
    ['deriveBits']
  )
  const derivedBits = await cryptoApi.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array([]),
      info: new TextEncoder().encode(RECOVERY_DERIVATION_INFO),
    },
    keyMaterial,
    RECOVERY_KEY_BYTES * 8
  )

  return new Uint8Array(derivedBits)
}

export function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(value: string): Uint8Array {
  const hex = value.trim()
  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error('非法 hex 内容')
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < hex.length; index += 2) {
    const byte = Number.parseInt(hex.slice(index, index + 2), 16)
    if (Number.isNaN(byte)) {
      throw new Error('非法 hex 内容')
    }
    bytes[index / 2] = byte
  }

  return bytes
}
