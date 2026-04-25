import type { LocalAuthorKeyRecord } from '@/types/author-key'

const STORAGE_KEY = 'halo-private-posts.local-author-keys'

export function listLocalAuthorKeys(): LocalAuthorKeyRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(isLocalAuthorKeyRecord)
  } catch {
    return []
  }
}

export function listLocalAuthorKeysByOwner(ownerName: string): LocalAuthorKeyRecord[] {
  return listLocalAuthorKeys().filter((item) => item.ownerName === ownerName)
}

export function findLocalAuthorKey(fingerprint: string): LocalAuthorKeyRecord | undefined {
  return listLocalAuthorKeys().find((item) => item.fingerprint === fingerprint)
}

export function saveLocalAuthorKey(record: LocalAuthorKeyRecord): void {
  const items = listLocalAuthorKeys()
  const nextItems = [
    record,
    ...items.filter((item) => item.fingerprint !== record.fingerprint),
  ]

  persistLocalAuthorKeys(nextItems)
}

export function deleteLocalAuthorKey(fingerprint: string): void {
  const nextItems = listLocalAuthorKeys().filter((item) => item.fingerprint !== fingerprint)
  persistLocalAuthorKeys(nextItems)
}

function persistLocalAuthorKeys(items: LocalAuthorKeyRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

function isLocalAuthorKeyRecord(value: unknown): value is LocalAuthorKeyRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.ownerName === 'string'
    && typeof record.displayName === 'string'
    && typeof record.fingerprint === 'string'
    && typeof record.algorithm === 'string'
    && typeof record.createdAt === 'string'
    && isJsonObject(record.publicKey)
    && isJsonObject(record.privateKey)
}

function isJsonObject(value: unknown): value is JsonWebKey {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
