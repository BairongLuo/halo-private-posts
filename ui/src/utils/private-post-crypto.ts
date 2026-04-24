import { marked } from 'marked'
import { scrypt } from 'scrypt-js'

import type {
  DecryptedPrivatePostDocument,
  EncryptedPrivatePostBundle,
} from '@/types/private-post'

const SCRYPT_N = 1 << 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const AES_GCM_TAG_LENGTH = 128

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} 不能为空`)
  }
  return value
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  return value
}

function readRequiredNumber(value: unknown, fieldName: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} 必须是数字`)
  }
  return parsed
}

export function parseBundleJson(bundleText: string): EncryptedPrivatePostBundle {
  let parsed: unknown
  try {
    parsed = JSON.parse(bundleText)
  } catch {
    throw new Error('Bundle JSON 无法解析')
  }

  return normalizeBundle(parsed)
}

export function normalizeBundle(bundle: unknown): EncryptedPrivatePostBundle {
  if (!isRecord(bundle)) {
    throw new Error('Bundle 必须是 JSON 对象')
  }

  const metadata = bundle.metadata
  if (!isRecord(metadata)) {
    throw new Error('Bundle metadata 缺失')
  }

  return {
    version: readRequiredNumber(bundle.version, 'version'),
    payload_format: readNonEmptyString(bundle.payload_format, 'payload_format'),
    cipher: readNonEmptyString(bundle.cipher, 'cipher'),
    kdf: readNonEmptyString(bundle.kdf, 'kdf'),
    salt: readNonEmptyString(bundle.salt, 'salt'),
    data_iv: readNonEmptyString(bundle.data_iv, 'data_iv'),
    ciphertext: readNonEmptyString(bundle.ciphertext, 'ciphertext'),
    auth_tag: readNonEmptyString(bundle.auth_tag, 'auth_tag'),
    metadata: {
      slug: readNonEmptyString(metadata.slug, 'metadata.slug'),
      title: readNonEmptyString(metadata.title, 'metadata.title'),
      excerpt: readOptionalString(metadata.excerpt),
      published_at: readOptionalString(metadata.published_at),
    },
  }
}

export async function decryptPrivatePost(
  bundle: EncryptedPrivatePostBundle,
  password: string
): Promise<DecryptedPrivatePostDocument> {
  const normalizedBundle = normalizeBundle(bundle)
  if (password.length === 0) {
    throw new Error('访问密码不能为空')
  }

  if (normalizedBundle.version !== 1) {
    throw new Error('只支持 EncryptedPrivatePostBundle v1')
  }

  if (normalizedBundle.payload_format !== 'markdown') {
    throw new Error('只支持 markdown payload')
  }

  if (normalizedBundle.cipher !== 'aes-256-gcm' || normalizedBundle.kdf !== 'scrypt') {
    throw new Error('当前 bundle 的算法组合不受支持')
  }

  const cryptoApi = globalThis.crypto?.subtle
  if (!cryptoApi) {
    throw new Error('当前环境不支持 Web Crypto API')
  }

  const salt = hexToBytes(normalizedBundle.salt)
  const iv = hexToBytes(normalizedBundle.data_iv)
  const ciphertext = hexToBytes(normalizedBundle.ciphertext)
  const authTag = hexToBytes(normalizedBundle.auth_tag)
  const derivedKey = await scrypt(
    new TextEncoder().encode(password),
    salt,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    32
  )

  const cryptoKey = await cryptoApi.importKey('raw', derivedKey, 'AES-GCM', false, ['decrypt'])

  try {
    const plaintextBuffer = await cryptoApi.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: AES_GCM_TAG_LENGTH,
      },
      cryptoKey,
      joinBytes(ciphertext, authTag)
    )

    const parsed = JSON.parse(new TextDecoder().decode(plaintextBuffer)) as Record<
      string,
      unknown
    >
    const markdown = readNonEmptyString(parsed.markdown, 'payload.markdown')

    return {
      metadata: normalizedBundle.metadata,
      markdown,
    }
  } catch {
    throw new Error('访问密码错误，或密文已损坏')
  }
}

export async function renderMarkdown(markdown: string): Promise<string> {
  return await marked.parse(markdown)
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.trim()
  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw new Error('Bundle 中存在非法 hex 字段')
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < hex.length; index += 2) {
    const byte = Number.parseInt(hex.slice(index, index + 2), 16)
    if (Number.isNaN(byte)) {
      throw new Error('Bundle 中存在非法 hex 字段')
    }
    bytes[index / 2] = byte
  }
  return bytes
}

function joinBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length)
  joined.set(left, 0)
  joined.set(right, left.length)
  return joined
}
