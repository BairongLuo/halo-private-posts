import { marked } from 'marked'
import { scrypt } from 'scrypt-js'

import type { AuthorKeyRecipient } from '@/types/author-key'
import type {
  BundleMetadata,
  DecryptedPrivatePostDocument,
  EncryptedPrivatePostBundle,
  PasswordSlot,
} from '@/types/private-post'
import {
  unwrapContentKeyWithAuthorKey,
  wrapContentKeyForAuthor,
} from '@/utils/author-key-crypto'

const BUNDLE_VERSION = 2
const BUNDLE_CIPHER = 'aes-256-gcm'
const BUNDLE_KDF = 'envelope'
const PASSWORD_SLOT_KDF = 'scrypt'
const SCRYPT_N = 1 << 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const AES_GCM_TAG_LENGTH = 128
const AES_GCM_TAG_BYTES = AES_GCM_TAG_LENGTH / 8
const BUNDLE_SALT_BYTES = 16
const BUNDLE_IV_BYTES = 12
const CONTENT_KEY_BYTES = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} 不能为空`)
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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeBundleMetadata(metadata: unknown): BundleMetadata {
  if (!isRecord(metadata)) {
    throw new Error('Bundle metadata 缺失')
  }

  return {
    slug: readNonEmptyString(metadata.slug, 'metadata.slug'),
    title: readNonEmptyString(metadata.title, 'metadata.title'),
    excerpt: readOptionalString(metadata.excerpt),
    published_at: readOptionalString(metadata.published_at),
  }
}

function normalizePrivatePostDocument(document: unknown): DecryptedPrivatePostDocument {
  if (!isRecord(document)) {
    throw new Error('私密正文内容必须是对象')
  }

  return {
    metadata: normalizeBundleMetadata(document.metadata),
    markdown: readNonEmptyString(document.markdown, 'payload.markdown'),
  }
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

  const authorSlotsRaw = bundle.author_slots
  if (!Array.isArray(authorSlotsRaw)) {
    throw new Error('author_slots 必须是数组')
  }

  return {
    version: readRequiredNumber(bundle.version, 'version'),
    payload_format: readNonEmptyString(bundle.payload_format, 'payload_format'),
    cipher: readNonEmptyString(bundle.cipher, 'cipher'),
    kdf: readNonEmptyString(bundle.kdf, 'kdf'),
    data_iv: readNonEmptyString(bundle.data_iv, 'data_iv'),
    ciphertext: readNonEmptyString(bundle.ciphertext, 'ciphertext'),
    auth_tag: readNonEmptyString(bundle.auth_tag, 'auth_tag'),
    password_slot: normalizePasswordSlot(bundle.password_slot),
    author_slots: authorSlotsRaw.map((slot) => normalizeAuthorSlot(slot)),
    metadata: normalizeBundleMetadata(bundle.metadata),
  }
}

export async function encryptPrivatePost(
  document: DecryptedPrivatePostDocument,
  password: string,
  authorRecipients: AuthorKeyRecipient[] = []
): Promise<EncryptedPrivatePostBundle> {
  const normalizedDocument = normalizePrivatePostDocument(document)
  if (password.length === 0) {
    throw new Error('访问密码不能为空')
  }

  const cryptoObject = globalThis.crypto
  const cryptoApi = cryptoObject?.subtle
  if (!cryptoObject?.getRandomValues || !cryptoApi) {
    throw new Error('当前环境不支持 Web Crypto API')
  }

  const contentKeyBytes = cryptoObject.getRandomValues(new Uint8Array(CONTENT_KEY_BYTES))
  const contentKey = await cryptoApi.importKey(
    'raw',
    contentKeyBytes,
    'AES-GCM',
    false,
    ['encrypt']
  )
  const contentIv = cryptoObject.getRandomValues(new Uint8Array(BUNDLE_IV_BYTES))
  const payloadBytes = new TextEncoder().encode(
    JSON.stringify({
      markdown: normalizedDocument.markdown,
    })
  )
  const encryptedPayload = new Uint8Array(
    await cryptoApi.encrypt(
      {
        name: 'AES-GCM',
        iv: contentIv,
        tagLength: AES_GCM_TAG_LENGTH,
      },
      contentKey,
      payloadBytes
    )
  )

  if (encryptedPayload.length <= AES_GCM_TAG_BYTES) {
    throw new Error('生成 bundle 失败：密文长度异常')
  }

  const wrappedContentKey = await createWrappedContentKey(password, contentKeyBytes)

  if (wrappedContentKey.wrappedContentKey.length <= AES_GCM_TAG_BYTES) {
    throw new Error('生成 bundle 失败：CEK 包裹长度异常')
  }

  const contentCiphertext = encryptedPayload.slice(0, -AES_GCM_TAG_BYTES)
  const contentAuthTag = encryptedPayload.slice(-AES_GCM_TAG_BYTES)
  const authorSlots = await Promise.all(authorRecipients.map(async (recipient) => {
    return {
      key_id: recipient.keyId,
      algorithm: recipient.algorithm,
      wrapped_cek: await wrapContentKeyForAuthor(recipient.publicKey, contentKeyBytes),
    }
  }))

  return {
    version: BUNDLE_VERSION,
    payload_format: 'markdown',
    cipher: BUNDLE_CIPHER,
    kdf: BUNDLE_KDF,
    data_iv: bytesToHex(contentIv),
    ciphertext: bytesToHex(contentCiphertext),
    auth_tag: bytesToHex(contentAuthTag),
    password_slot: buildPasswordSlotFromWrappedContentKey(wrappedContentKey),
    author_slots: authorSlots,
    metadata: normalizedDocument.metadata,
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

  validateSupportedBundle(normalizedBundle)

  const cek = await unwrapContentKeyWithPassword(normalizedBundle, password)
  return await decryptDocumentWithContentKey(normalizedBundle, cek)
}

export async function decryptPrivatePostWithAuthorKey(
  bundle: EncryptedPrivatePostBundle,
  privateKey: JsonWebKey
): Promise<DecryptedPrivatePostDocument> {
  const normalizedBundle = normalizeBundle(bundle)
  validateSupportedBundle(normalizedBundle)

  const cek = await unwrapContentKeyWithAuthorSlots(normalizedBundle, privateKey)
  return await decryptDocumentWithContentKey(normalizedBundle, cek)
}

export async function rewrapPrivatePostPassword(
  bundle: EncryptedPrivatePostBundle,
  nextPassword: string,
  privateKey: JsonWebKey
): Promise<EncryptedPrivatePostBundle> {
  const normalizedBundle = normalizeBundle(bundle)
  if (nextPassword.length === 0) {
    throw new Error('访问密码不能为空')
  }

  validateSupportedBundle(normalizedBundle)

  const cek = await unwrapContentKeyWithAuthorSlots(normalizedBundle, privateKey)
  const wrappedContentKey = await createWrappedContentKey(nextPassword, cek)

  return {
    ...normalizedBundle,
    metadata: {
      ...normalizedBundle.metadata,
    },
    author_slots: normalizedBundle.author_slots.map((slot) => ({
      ...slot,
    })),
    password_slot: buildPasswordSlotFromWrappedContentKey(wrappedContentKey),
  }
}

export async function renderMarkdown(markdown: string): Promise<string> {
  return await marked.parse(markdown)
}

function normalizePasswordSlot(passwordSlot: unknown) {
  if (!isRecord(passwordSlot)) {
    throw new Error('password_slot 缺失')
  }

  return {
    kdf: readNonEmptyString(passwordSlot.kdf, 'password_slot.kdf'),
    salt: readNonEmptyString(passwordSlot.salt, 'password_slot.salt'),
    wrap_iv: readNonEmptyString(passwordSlot.wrap_iv, 'password_slot.wrap_iv'),
    wrapped_cek: readNonEmptyString(passwordSlot.wrapped_cek, 'password_slot.wrapped_cek'),
    auth_tag: readNonEmptyString(passwordSlot.auth_tag, 'password_slot.auth_tag'),
  }
}

function normalizeAuthorSlot(authorSlot: unknown) {
  if (!isRecord(authorSlot)) {
    throw new Error('author_slot 必须是对象')
  }

  return {
    key_id: readNonEmptyString(authorSlot.key_id, 'author_slot.key_id'),
    algorithm: readNonEmptyString(authorSlot.algorithm, 'author_slot.algorithm'),
    wrapped_cek: readNonEmptyString(authorSlot.wrapped_cek, 'author_slot.wrapped_cek'),
  }
}

function validateSupportedBundle(bundle: EncryptedPrivatePostBundle): void {
  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`只支持 EncryptedPrivatePostBundle v${BUNDLE_VERSION}`)
  }

  if (bundle.payload_format !== 'markdown') {
    throw new Error('只支持 markdown payload')
  }

  if (bundle.cipher !== BUNDLE_CIPHER || bundle.kdf !== BUNDLE_KDF) {
    throw new Error('当前 bundle 的算法组合不受支持')
  }

  if (bundle.password_slot.kdf !== PASSWORD_SLOT_KDF) {
    throw new Error('当前 bundle 的 password slot 算法不受支持')
  }
}

async function unwrapContentKeyWithPassword(
  bundle: EncryptedPrivatePostBundle,
  password: string
): Promise<Uint8Array> {
  const cryptoApi = globalThis.crypto?.subtle
  if (!cryptoApi) {
    throw new Error('当前环境不支持 Web Crypto API')
  }

  const salt = hexToBytes(bundle.password_slot.salt)
  const wrapIv = hexToBytes(bundle.password_slot.wrap_iv)
  const wrappedCek = hexToBytes(bundle.password_slot.wrapped_cek)
  const authTag = hexToBytes(bundle.password_slot.auth_tag)
  const passwordWrappingBytes = await derivePasswordKeyBytes(password, salt)
  const passwordWrappingKey = await cryptoApi.importKey(
    'raw',
    passwordWrappingBytes,
    'AES-GCM',
    false,
    ['decrypt']
  )

  try {
    const plaintext = await cryptoApi.decrypt(
      {
        name: 'AES-GCM',
        iv: wrapIv,
        tagLength: AES_GCM_TAG_LENGTH,
      },
      passwordWrappingKey,
      joinBytes(wrappedCek, authTag)
    )

    return new Uint8Array(plaintext)
  } catch {
    throw new Error('访问密码错误，或密文已损坏')
  }
}

async function unwrapContentKeyWithAuthorSlots(
  bundle: EncryptedPrivatePostBundle,
  privateKey: JsonWebKey
): Promise<Uint8Array> {
  if (bundle.author_slots.length === 0) {
    throw new Error('当前 bundle 没有可用的作者钥匙槽')
  }

  for (const slot of bundle.author_slots) {
    try {
      return await unwrapContentKeyWithAuthorKey(privateKey, slot.wrapped_cek)
    } catch {
      continue
    }
  }

  throw new Error('当前本地作者私钥无法解锁这篇文章')
}

async function decryptDocumentWithContentKey(
  bundle: EncryptedPrivatePostBundle,
  contentKeyBytes: Uint8Array
): Promise<DecryptedPrivatePostDocument> {
  const cryptoApi = globalThis.crypto?.subtle
  if (!cryptoApi) {
    throw new Error('当前环境不支持 Web Crypto API')
  }

  const contentKey = await cryptoApi.importKey(
    'raw',
    contentKeyBytes,
    'AES-GCM',
    false,
    ['decrypt']
  )
  const iv = hexToBytes(bundle.data_iv)
  const ciphertext = hexToBytes(bundle.ciphertext)
  const authTag = hexToBytes(bundle.auth_tag)

  try {
    const plaintextBuffer = await cryptoApi.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: AES_GCM_TAG_LENGTH,
      },
      contentKey,
      joinBytes(ciphertext, authTag)
    )
    const parsed = JSON.parse(new TextDecoder().decode(plaintextBuffer)) as Record<string, unknown>
    const markdown = readNonEmptyString(parsed.markdown, 'payload.markdown')

    return {
      metadata: bundle.metadata,
      markdown,
    }
  } catch {
    throw new Error('访问密码错误，或密文已损坏')
  }
}

async function derivePasswordKeyBytes(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return await scrypt(
    new TextEncoder().encode(password),
    salt,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    32
  )
}

async function createWrappedContentKey(password: string, contentKeyBytes: Uint8Array): Promise<{
  salt: Uint8Array
  wrapIv: Uint8Array
  wrappedContentKey: Uint8Array
}> {
  const cryptoObject = globalThis.crypto
  const cryptoApi = cryptoObject?.subtle
  if (!cryptoObject?.getRandomValues || !cryptoApi) {
    throw new Error('当前环境不支持 Web Crypto API')
  }

  const salt = cryptoObject.getRandomValues(new Uint8Array(BUNDLE_SALT_BYTES))
  const wrapIv = cryptoObject.getRandomValues(new Uint8Array(BUNDLE_IV_BYTES))
  const passwordWrappingBytes = await derivePasswordKeyBytes(password, salt)
  const passwordWrappingKey = await cryptoApi.importKey(
    'raw',
    passwordWrappingBytes,
    'AES-GCM',
    false,
    ['encrypt']
  )
  const wrappedContentKey = new Uint8Array(
    await cryptoApi.encrypt(
      {
        name: 'AES-GCM',
        iv: wrapIv,
        tagLength: AES_GCM_TAG_LENGTH,
      },
      passwordWrappingKey,
      contentKeyBytes
    )
  )

  return {
    salt,
    wrapIv,
    wrappedContentKey,
  }
}

function buildPasswordSlotFromWrappedContentKey(args: {
  salt: Uint8Array
  wrapIv: Uint8Array
  wrappedContentKey: Uint8Array
}): PasswordSlot {
  const passwordSlotCiphertext = args.wrappedContentKey.slice(0, -AES_GCM_TAG_BYTES)
  const passwordSlotAuthTag = args.wrappedContentKey.slice(-AES_GCM_TAG_BYTES)

  return {
    kdf: PASSWORD_SLOT_KDF,
    salt: bytesToHex(args.salt),
    wrap_iv: bytesToHex(args.wrapIv),
    wrapped_cek: bytesToHex(passwordSlotCiphertext),
    auth_tag: bytesToHex(passwordSlotAuthTag),
  }
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

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
