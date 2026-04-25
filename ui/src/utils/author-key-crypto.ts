import type {
  AuthorKeyRecipient,
  AuthorKeyResource,
  LocalAuthorKeyRecord,
} from '@/types/author-key'

const AUTHOR_KEY_ALGORITHM = 'rsa-oaep-256'

export async function generateAuthorKeyRecord(args: {
  ownerName: string
  displayName: string
}): Promise<LocalAuthorKeyRecord> {
  const cryptoApi = requireCryptoApi()
  const keyPair = await cryptoApi.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  )

  const publicKey = await cryptoApi.exportKey('jwk', keyPair.publicKey)
  const privateKey = await cryptoApi.exportKey('jwk', keyPair.privateKey)
  const fingerprint = await computeAuthorKeyFingerprint(publicKey)

  return {
    ownerName: args.ownerName,
    displayName: args.displayName,
    fingerprint,
    algorithm: AUTHOR_KEY_ALGORITHM,
    publicKey,
    privateKey,
    createdAt: new Date().toISOString(),
  }
}

export async function importAuthorKeyRecord(bundleText: string): Promise<LocalAuthorKeyRecord> {
  const parsed = JSON.parse(bundleText) as Record<string, unknown>
  const ownerName = readNonEmptyString(parsed.ownerName, 'ownerName')
  const displayName = readNonEmptyString(parsed.displayName, 'displayName')
  const fingerprint = readNonEmptyString(parsed.fingerprint, 'fingerprint')
  const algorithm = readNonEmptyString(parsed.algorithm, 'algorithm')
  const createdAt = readNonEmptyString(parsed.createdAt, 'createdAt')
  const publicKey = readJsonWebKey(parsed.publicKey, 'publicKey')
  const privateKey = readJsonWebKey(parsed.privateKey, 'privateKey')

  if (algorithm !== AUTHOR_KEY_ALGORITHM) {
    throw new Error(`只支持 ${AUTHOR_KEY_ALGORITHM} 作者钥匙`)
  }

  const normalizedFingerprint = await computeAuthorKeyFingerprint(publicKey)
  if (normalizedFingerprint !== fingerprint) {
    throw new Error('作者钥匙指纹不匹配')
  }

  await importAuthorPublicKey(publicKey)
  await importAuthorPrivateKey(privateKey)

  return {
    ownerName,
    displayName,
    fingerprint,
    algorithm,
    publicKey,
    privateKey,
    createdAt,
  }
}

export function exportAuthorKeyRecord(record: LocalAuthorKeyRecord): string {
  return JSON.stringify(record, null, 2)
}

export async function computeAuthorKeyFingerprint(publicKey: JsonWebKey): Promise<string> {
  const payload = new TextEncoder().encode(stableStringify(publicKey))
  const digest = await requireCryptoApi().digest('SHA-256', payload)
  return bytesToHex(new Uint8Array(digest))
}

export async function buildAuthorKeyRecipients(
  resources: AuthorKeyResource[]
): Promise<AuthorKeyRecipient[]> {
  const recipients: AuthorKeyRecipient[] = []

  for (const resource of resources) {
    const publicKey = parsePublicKey(resource.spec.publicKey)
    await importAuthorPublicKey(publicKey)
    recipients.push({
      keyId: resource.spec.fingerprint,
      algorithm: resource.spec.algorithm,
      publicKey,
    })
  }

  return recipients
}

export async function wrapContentKeyForAuthor(
  publicKey: JsonWebKey,
  cek: Uint8Array
): Promise<string> {
  const cryptoKey = await importAuthorPublicKey(publicKey)
  const wrapped = await requireCryptoApi().encrypt(
    {
      name: 'RSA-OAEP',
    },
    cryptoKey,
    cek
  )

  return bytesToHex(new Uint8Array(wrapped))
}

export async function unwrapContentKeyWithAuthorKey(
  privateKey: JsonWebKey,
  wrappedCekHex: string
): Promise<Uint8Array> {
  const cryptoKey = await importAuthorPrivateKey(privateKey)
  const plaintext = await requireCryptoApi().decrypt(
    {
      name: 'RSA-OAEP',
    },
    cryptoKey,
    hexToBytes(wrappedCekHex)
  )

  return new Uint8Array(plaintext)
}

export function parsePublicKey(publicKeyText: string): JsonWebKey {
  try {
    return readJsonWebKey(JSON.parse(publicKeyText), 'publicKey')
  } catch {
    throw new Error('作者公钥格式无效')
  }
}

async function importAuthorPublicKey(publicKey: JsonWebKey): Promise<CryptoKey> {
  return await requireCryptoApi().importKey(
    'jwk',
    publicKey,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['encrypt']
  )
}

async function importAuthorPrivateKey(privateKey: JsonWebKey): Promise<CryptoKey> {
  return await requireCryptoApi().importKey(
    'jwk',
    privateKey,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['decrypt']
  )
}

function requireCryptoApi(): SubtleCrypto {
  const cryptoApi = globalThis.crypto?.subtle
  if (!cryptoApi) {
    throw new Error('当前环境不支持 Web Crypto API')
  }

  return cryptoApi
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} 不能为空`)
  }

  return value
}

function readJsonWebKey(value: unknown, fieldName: string): JsonWebKey {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是对象`)
  }

  return value as JsonWebKey
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function hexToBytes(value: string): Uint8Array {
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

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
