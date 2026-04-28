import { Marked } from 'marked'
import { scrypt } from 'scrypt-js'

import type {
  BundleMetadata,
  DecryptedPrivatePostDocument,
  EncryptedPrivatePostBundle,
  PasswordSlot,
  PrivatePostPayloadFormat,
  SiteRecoveryPublicKey,
  SiteRecoverySlot,
} from '@/types/private-post'

const BUNDLE_VERSION = 3
const BUNDLE_CIPHER = 'aes-256-gcm'
const BUNDLE_KDF = 'envelope'
const PASSWORD_SLOT_KDF = 'scrypt'
const SITE_RECOVERY_WRAP_ALGORITHM = 'RSA-OAEP-256'
const AES_GCM_ALGORITHM = 'aes-256-gcm'
const AES_GCM_TAG_LENGTH = 128
const AES_GCM_TAG_BYTES = AES_GCM_TAG_LENGTH / 8
const BUNDLE_SALT_BYTES = 16
const BUNDLE_IV_BYTES = 12
const CONTENT_KEY_BYTES = 32
const SCRYPT_N = 1 << 15
const SCRYPT_R = 8
const SCRYPT_P = 1
const MARKDOWN_RENDERER_BASE_URL = 'https://halo-private-posts.invalid'
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const ALLOWED_IMAGE_PROTOCOLS = new Set(['http:', 'https:'])
const RELATIVE_URL_PATTERN = /^(?:\/(?!\/)|\.{1,2}\/|#|\?)/
const SUPPORTED_PAYLOAD_FORMATS = new Set<PrivatePostPayloadFormat>(['markdown', 'html'])
const ALLOWED_LINK_TARGETS = new Set(['_blank', '_self', '_parent', '_top'])
const BLOCKED_HTML_TAGS = new Set([
  'applet',
  'base',
  'embed',
  'form',
  'frame',
  'frameset',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'object',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
])
const ALLOWED_HTML_TAGS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'var',
])
const PRESERVED_GLOBAL_HTML_ATTRIBUTES = new Set([
  'class',
  'dir',
  'id',
  'lang',
  'role',
  'title',
])
const PRESERVED_HTML_ATTRIBUTES_BY_TAG: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'rel', 'target']),
  details: new Set(['open']),
  img: new Set(['alt', 'height', 'loading', 'src', 'width']),
  li: new Set(['value']),
  ol: new Set(['reversed', 'start']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
}
const HTML_URL_ATTRIBUTE_PROTOCOLS: Record<string, ReadonlySet<string>> = {
  href: ALLOWED_LINK_PROTOCOLS,
  src: ALLOWED_IMAGE_PROTOCOLS,
}

const safeMarked = new Marked({
  gfm: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    link({ href, title, tokens }) {
      const textHtml = this.parser.parseInline(tokens)
      const safeHref = sanitizeUrl(href, ALLOWED_LINK_PROTOCOLS)
      if (!safeHref) {
        return textHtml
      }

      return `<a href="${escapeHtml(safeHref)}"${renderTitleAttribute(title)} rel="nofollow noopener noreferrer">${textHtml}</a>`
    },
    image({ href, title, text }) {
      const safeSrc = sanitizeUrl(href, ALLOWED_IMAGE_PROTOCOLS)
      if (!safeSrc) {
        return escapeHtml(text)
      }

      return `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(text)}"${renderTitleAttribute(title)} />`
    },
  },
})

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

  const payloadFormat = normalizePayloadFormat(document.payload_format ?? 'markdown', 'payload.payload_format')

  return {
    metadata: normalizeBundleMetadata(document.metadata),
    payload_format: payloadFormat,
    content: readPrivatePostPayloadContent(document, payloadFormat),
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

  return {
    version: readRequiredNumber(bundle.version, 'version'),
    payload_format: readNonEmptyString(bundle.payload_format, 'payload_format'),
    cipher: readNonEmptyString(bundle.cipher, 'cipher'),
    kdf: readNonEmptyString(bundle.kdf, 'kdf'),
    data_iv: readNonEmptyString(bundle.data_iv, 'data_iv'),
    ciphertext: readNonEmptyString(bundle.ciphertext, 'ciphertext'),
    auth_tag: readNonEmptyString(bundle.auth_tag, 'auth_tag'),
    password_slot: normalizePasswordSlot(bundle.password_slot),
    site_recovery_slot: normalizeSiteRecoverySlot(bundle.site_recovery_slot),
    metadata: normalizeBundleMetadata(bundle.metadata),
  }
}

export async function encryptPrivatePost(
  document: DecryptedPrivatePostDocument,
  password: string,
  siteRecoveryPublicKey: SiteRecoveryPublicKey
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
  const payload: Record<string, string> = {
    content: normalizedDocument.content,
  }
  if (normalizedDocument.payload_format === 'markdown') {
    payload.markdown = normalizedDocument.content
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
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

  const wrappedPasswordKey = await createPasswordWrappedContentKey(password, contentKeyBytes)
  if (wrappedPasswordKey.wrappedContentKey.length <= AES_GCM_TAG_BYTES) {
    throw new Error('生成 bundle 失败：password slot 长度异常')
  }

  const wrappedSiteRecoveryKey = await createSiteRecoveryWrappedContentKey(
    siteRecoveryPublicKey,
    contentKeyBytes
  )

  const contentCiphertext = encryptedPayload.slice(0, -AES_GCM_TAG_BYTES)
  const contentAuthTag = encryptedPayload.slice(-AES_GCM_TAG_BYTES)

  return {
    version: BUNDLE_VERSION,
    payload_format: normalizedDocument.payload_format,
    cipher: BUNDLE_CIPHER,
    kdf: BUNDLE_KDF,
    data_iv: bytesToHex(contentIv),
    ciphertext: bytesToHex(contentCiphertext),
    auth_tag: bytesToHex(contentAuthTag),
    password_slot: buildPasswordSlotFromWrappedContentKey(wrappedPasswordKey),
    site_recovery_slot: buildSiteRecoverySlot(siteRecoveryPublicKey, wrappedSiteRecoveryKey),
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

export async function rewrapPrivatePostPasswordWithContentKey(
  bundle: EncryptedPrivatePostBundle,
  contentKeyBytes: Uint8Array,
  nextPassword: string
): Promise<EncryptedPrivatePostBundle> {
  const normalizedBundle = normalizeBundle(bundle)
  if (nextPassword.length === 0) {
    throw new Error('访问密码不能为空')
  }

  validateSupportedBundle(normalizedBundle)

  const wrappedContentKey = await createPasswordWrappedContentKey(nextPassword, contentKeyBytes)

  return {
    ...normalizedBundle,
    metadata: {
      ...normalizedBundle.metadata,
    },
    site_recovery_slot: {
      ...normalizedBundle.site_recovery_slot,
    },
    password_slot: buildPasswordSlotFromWrappedContentKey(wrappedContentKey),
  }
}

export async function renderMarkdown(markdown: string): Promise<string> {
  return safeMarked.parse(markdown, { async: false })
}

export async function renderPrivatePostDocument(
  document: DecryptedPrivatePostDocument
): Promise<string> {
  const normalizedDocument = normalizePrivatePostDocument(document)

  if (normalizedDocument.payload_format === 'html') {
    return sanitizeHtmlFragment(normalizedDocument.content)
  }

  return await renderMarkdown(normalizedDocument.content)
}

function normalizePasswordSlot(passwordSlot: unknown): PasswordSlot {
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

function normalizeSiteRecoverySlot(siteRecoverySlot: unknown): SiteRecoverySlot {
  if (!isRecord(siteRecoverySlot)) {
    throw new Error('site_recovery_slot 缺失')
  }

  return {
    kid: readNonEmptyString(siteRecoverySlot.kid, 'site_recovery_slot.kid'),
    alg: readNonEmptyString(siteRecoverySlot.alg, 'site_recovery_slot.alg'),
    wrapped_cek: readNonEmptyString(siteRecoverySlot.wrapped_cek, 'site_recovery_slot.wrapped_cek'),
  }
}

function validateSupportedBundle(bundle: EncryptedPrivatePostBundle): void {
  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`只支持 EncryptedPrivatePostBundle v${BUNDLE_VERSION}`)
  }

  normalizePayloadFormat(bundle.payload_format, 'payload_format')

  if (bundle.cipher !== BUNDLE_CIPHER || bundle.kdf !== BUNDLE_KDF) {
    throw new Error('当前 bundle 的算法组合不受支持')
  }

  if (bundle.password_slot.kdf !== PASSWORD_SLOT_KDF) {
    throw new Error('当前 bundle 的 password slot 算法不受支持')
  }

  if (bundle.site_recovery_slot.alg !== SITE_RECOVERY_WRAP_ALGORITHM) {
    throw new Error('当前 bundle 的平台恢复算法不受支持')
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
  let plaintextBuffer: ArrayBuffer

  try {
    plaintextBuffer = await cryptoApi.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: AES_GCM_TAG_LENGTH,
      },
      contentKey,
      joinBytes(ciphertext, authTag)
    )
  } catch {
    throw new Error('访问密码错误，或密文已损坏')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintextBuffer))
  } catch {
    throw new Error('私密正文内容无法解析')
  }

  if (!isRecord(parsed)) {
    throw new Error('私密正文内容必须是对象')
  }

  const payloadFormat = normalizePayloadFormat(bundle.payload_format, 'payload_format')

  return {
    metadata: bundle.metadata,
    payload_format: payloadFormat,
    content: readPrivatePostPayloadContent(parsed, payloadFormat),
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

async function createPasswordWrappedContentKey(password: string, contentKeyBytes: Uint8Array): Promise<{
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

async function createSiteRecoveryWrappedContentKey(
  siteRecoveryPublicKey: SiteRecoveryPublicKey,
  contentKeyBytes: Uint8Array
): Promise<Uint8Array> {
  const cryptoApi = globalThis.crypto?.subtle
  if (!cryptoApi) {
    throw new Error('当前环境不支持 Web Crypto API')
  }

  let publicKey: CryptoKey
  try {
    publicKey = await cryptoApi.importKey(
      'spki',
      base64ToBytes(siteRecoveryPublicKey.publicKey),
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256',
      },
      false,
      ['encrypt']
    )
  } catch {
    throw new Error('平台恢复公钥无效')
  }

  try {
    return new Uint8Array(
      await cryptoApi.encrypt(
        {
          name: 'RSA-OAEP',
        },
        publicKey,
        contentKeyBytes
      )
    )
  } catch {
    throw new Error('生成 bundle 失败：平台恢复槽写入失败')
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

function buildSiteRecoverySlot(
  siteRecoveryPublicKey: SiteRecoveryPublicKey,
  wrappedContentKey: Uint8Array
): SiteRecoverySlot {
  return {
    kid: siteRecoveryPublicKey.kid,
    alg: siteRecoveryPublicKey.alg,
    wrapped_cek: bytesToHex(wrappedContentKey),
  }
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error('非法 base64 内容')
  }

  if (!globalThis.atob) {
    throw new Error('当前环境不支持 base64 解码')
  }

  let binary: string
  try {
    binary = globalThis.atob(normalized)
  } catch {
    throw new Error('非法 base64 内容')
  }

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
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

function sanitizeUrl(
  value: string | null | undefined,
  allowedProtocols: ReadonlySet<string>
): string | null {
  if (!value) {
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  if (RELATIVE_URL_PATTERN.test(normalized)) {
    return normalized
  }

  try {
    const resolved = new URL(normalized, MARKDOWN_RENDERER_BASE_URL)
    return allowedProtocols.has(resolved.protocol) ? normalized : null
  } catch {
    return null
  }
}

function renderTitleAttribute(title: string | null | undefined): string {
  return title ? ` title="${escapeHtml(title)}"` : ''
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizePayloadFormat(
  value: unknown,
  fieldName: string
): PrivatePostPayloadFormat {
  const normalized = readNonEmptyString(value, fieldName).trim().toLowerCase()
  if (SUPPORTED_PAYLOAD_FORMATS.has(normalized as PrivatePostPayloadFormat)) {
    return normalized as PrivatePostPayloadFormat
  }

  throw new Error(`${fieldName} 暂不支持: ${value}`)
}

function readPrivatePostPayloadContent(
  payload: Record<string, unknown>,
  payloadFormat: PrivatePostPayloadFormat
): string {
  if (payloadFormat === 'markdown') {
    if (typeof payload.content === 'string' && payload.content.trim().length > 0) {
      return readNonEmptyString(payload.content, 'payload.content')
    }

    return readNonEmptyString(payload.markdown, 'payload.markdown')
  }

  return readNonEmptyString(payload.content, 'payload.content')
}

function sanitizeHtmlFragment(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return escapeHtml(html)
  }

  const document = new DOMParser().parseFromString(html, 'text/html')
  const elements = Array.from(document.body.querySelectorAll('*'))

  elements.forEach((element) => {
    if (!element.isConnected) {
      return
    }

    const tagName = element.tagName.toLowerCase()
    if (BLOCKED_HTML_TAGS.has(tagName)) {
      element.remove()
      return
    }

    if (!ALLOWED_HTML_TAGS.has(tagName)) {
      unwrapHtmlElement(element)
      return
    }

    sanitizeHtmlAttributes(element, tagName)
  })

  return document.body.innerHTML
}

function unwrapHtmlElement(element: Element): void {
  const parent = element.parentNode
  if (!parent) {
    element.remove()
    return
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }

  element.remove()
}

function sanitizeHtmlAttributes(element: Element, tagName: string): void {
  Array.from(element.attributes).forEach((attribute) => {
    const attributeName = attribute.name.toLowerCase()

    if (
      attributeName.startsWith('on')
      || attributeName === 'srcdoc'
      || attributeName === 'style'
    ) {
      element.removeAttribute(attribute.name)
      return
    }

    if (attributeName in HTML_URL_ATTRIBUTE_PROTOCOLS) {
      const safeUrl = sanitizeUrl(
        attribute.value,
        HTML_URL_ATTRIBUTE_PROTOCOLS[attributeName]
      )
      if (safeUrl) {
        element.setAttribute(attribute.name, safeUrl)
      } else {
        element.removeAttribute(attribute.name)
      }
      return
    }

    if (attributeName === 'target' && tagName === 'a') {
      const normalizedTarget = attribute.value.trim().toLowerCase()
      if (!ALLOWED_LINK_TARGETS.has(normalizedTarget)) {
        element.removeAttribute(attribute.name)
      }
      return
    }

    if (attributeName.startsWith('aria-')) {
      return
    }

    const preservedAttributes = PRESERVED_HTML_ATTRIBUTES_BY_TAG[tagName]
    if (
      PRESERVED_GLOBAL_HTML_ATTRIBUTES.has(attributeName)
      || preservedAttributes?.has(attributeName)
    ) {
      return
    }

    element.removeAttribute(attribute.name)
  })

  if (tagName === 'a' && element.getAttribute('href')) {
    element.setAttribute('rel', 'nofollow noopener noreferrer')
  }
}
