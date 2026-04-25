import {
  buildAuthorKeyResource,
  listAuthorKeysByOwner,
  upsertAuthorKey,
} from '@/api/author-keys'
import { getCurrentHaloUserName } from '@/api/users'
import type {
  AuthorKeyRecipient,
  AuthorKeyResource,
  LocalAuthorKeyRecord,
} from '@/types/author-key'
import {
  buildAuthorKeyRecipients,
  generateAuthorKeyRecord,
} from '@/utils/author-key-crypto'
import {
  listLocalAuthorKeysByOwner,
  saveLocalAuthorKey,
} from '@/utils/author-key-store'

const DEFAULT_AUTHOR_KEY_DISPLAY_NAME = '默认作者钥匙'

export interface DefaultAuthorKeyContext {
  ownerName: string
  primaryFingerprint: string
  recipients: AuthorKeyRecipient[]
  localAvailable: boolean
  wasCreated: boolean
}

export async function ensureDefaultAuthorKey(): Promise<DefaultAuthorKeyContext> {
  const ownerName = await getCurrentHaloUserName()
  const remoteKeys = await listAuthorKeysByOwner(ownerName)
  const localKeys = listLocalAuthorKeysByOwner(ownerName)

  let primaryRemoteKey: AuthorKeyResource
  let primaryLocalKey: LocalAuthorKeyRecord
  let wasCreated = false

  const matchedRemoteKeys = remoteKeys.filter((remoteKey) => {
    return localKeys.some((localKey) => localKey.fingerprint === remoteKey.spec.fingerprint)
  })

  if (matchedRemoteKeys.length > 0) {
    primaryRemoteKey = pickPrimaryRemoteKey(matchedRemoteKeys)
    primaryLocalKey = localKeys.find((item) => item.fingerprint === primaryRemoteKey.spec.fingerprint)!
  } else {
    primaryLocalKey = localKeys.length > 0
      ? pickPrimaryLocalKey(localKeys)
      : await generateInitialLocalKey(ownerName)

    if (localKeys.length === 0) {
      saveLocalAuthorKey(primaryLocalKey)
      wasCreated = true
    }

    primaryRemoteKey = await upsertAuthorKey(buildAuthorKeyResource({
      ownerName: primaryLocalKey.ownerName,
      displayName: primaryLocalKey.displayName,
      fingerprint: primaryLocalKey.fingerprint,
      algorithm: primaryLocalKey.algorithm,
      publicKey: JSON.stringify(primaryLocalKey.publicKey),
      createdAt: primaryLocalKey.createdAt,
    }))
  }

  const recipients = await buildAuthorKeyRecipients([primaryRemoteKey])
  return {
    ownerName,
    primaryFingerprint: primaryRemoteKey.spec.fingerprint,
    recipients,
    localAvailable: true,
    wasCreated,
  }
}

function pickPrimaryRemoteKey(items: AuthorKeyResource[]): AuthorKeyResource {
  return [...items].sort((left, right) => compareAuthorKeyOrder(
    left.spec.createdAt,
    right.spec.createdAt,
    left.spec.fingerprint,
    right.spec.fingerprint
  )).at(-1)!
}

function pickPrimaryLocalKey(items: LocalAuthorKeyRecord[]): LocalAuthorKeyRecord {
  return [...items].sort((left, right) => compareAuthorKeyOrder(
    left.createdAt,
    right.createdAt,
    left.fingerprint,
    right.fingerprint
  )).at(-1)!
}

async function generateInitialLocalKey(ownerName: string): Promise<LocalAuthorKeyRecord> {
  return await generateAuthorKeyRecord({
    ownerName,
    displayName: DEFAULT_AUTHOR_KEY_DISPLAY_NAME,
  })
}

function compareAuthorKeyOrder(
  leftCreatedAt: string,
  rightCreatedAt: string,
  leftFingerprint: string,
  rightFingerprint: string
): number {
  const leftTime = readTimestamp(leftCreatedAt)
  const rightTime = readTimestamp(rightCreatedAt)
  if (leftTime !== rightTime) {
    return leftTime - rightTime
  }

  return leftFingerprint.localeCompare(rightFingerprint)
}

function readTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}
