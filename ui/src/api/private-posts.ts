import { axiosInstance } from '@halo-dev/api-client'

import { getHaloPostLockState } from '@/api/posts'
import type {
  EncryptedPrivatePostBundle,
  PrivatePost,
  PrivatePostList,
  SiteRecoveryPublicKey,
  SiteRecoveryRefreshRequest,
  SiteRecoveryResetRequest,
} from '@/types/private-post'

const API_BASE = '/apis/privateposts.halo.run/v1alpha1/privateposts'
const CONSOLE_API_BASE = '/apis/api.console.halo.run/v1alpha1/private-posts'
const DEFAULT_LIST_PAGE_SIZE = 200
const DEFAULT_SYNC_TIMEOUT_MS = 5000
const DEFAULT_SYNC_INTERVAL_MS = 150

export async function listPrivatePosts(): Promise<PrivatePost[]> {
  const items = await listAllPrivatePostResources()
  const activeItems = await Promise.all(
    items.map(async (item) => {
      const state = await getHaloPostLockState(item.spec.postName)
      return state.active && state.hasPrivateBundle ? item : null
    })
  )

  return activeItems.filter((item): item is PrivatePost => item !== null)
}

export async function fetchSiteRecoveryPublicKey(): Promise<SiteRecoveryPublicKey> {
  const { data } = await axiosInstance.get<SiteRecoveryPublicKey>(
    `${CONSOLE_API_BASE}/site-recovery-key`
  )
  return data
}

export async function resetPrivatePostPasswordWithSiteRecovery(
  request: SiteRecoveryResetRequest
): Promise<void> {
  await axiosInstance.post(`${CONSOLE_API_BASE}/reset-password`, request)
}

export async function refreshPrivatePostBundleWithSiteRecovery(
  request: SiteRecoveryRefreshRequest
): Promise<EncryptedPrivatePostBundle> {
  const { data } = await axiosInstance.post<{
    bundle: EncryptedPrivatePostBundle
  }>(`${CONSOLE_API_BASE}/refresh-bundle`, request)
  return data.bundle
}

export async function waitForPrivatePostSync(args: {
  postName: string
  expectedBundle?: EncryptedPrivatePostBundle
  timeoutMs?: number
  intervalMs?: number
}): Promise<PrivatePost | null> {
  const expectedBundle = args.expectedBundle
  const timeoutMs = args.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS
  const intervalMs = args.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    try {
      const privatePost = await findPrivatePostByPostName(args.postName)
      if (privatePost && bundleMatches(privatePost, expectedBundle)) {
        return privatePost
      }
    } catch {
      // Sync is eventual here. Polling should not turn a successful save into a hard failure.
    }

    await sleep(intervalMs)
  }

  return null
}

export async function waitForPrivatePostRemoval(args: {
  postName: string
  timeoutMs?: number
  intervalMs?: number
}): Promise<boolean> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS
  const intervalMs = args.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    try {
      const privatePost = await findPrivatePostByPostName(args.postName)
      if (!privatePost) {
        return true
      }
    } catch {
      // Treat polling failures as transient while the background sync catches up.
    }

    await sleep(intervalMs)
  }

  return false
}

async function findPrivatePostByPostName(postName: string): Promise<PrivatePost | null> {
  const items = await findPrivatePostsByPostName(postName)
  return items[0] ?? null
}

async function fetchPrivatePostPage(page: number, size: number): Promise<PrivatePostList> {
  const { data } = await axiosInstance.get<PrivatePostList>(API_BASE, {
    params: {
      page,
      size,
      sort: 'metadata.creationTimestamp,desc',
    },
  })

  return data
}

async function listAllPrivatePostResources(includeDeleted = false): Promise<PrivatePost[]> {
  const items: PrivatePost[] = []
  let page = 1

  while (true) {
    const data = await fetchPrivatePostPage(page, DEFAULT_LIST_PAGE_SIZE)
    const currentItems = data.items ?? []
    items.push(...currentItems)

    const loaded = (page - 1) * DEFAULT_LIST_PAGE_SIZE + currentItems.length
    if (currentItems.length === 0 || loaded >= data.total) {
      break
    }

    page += 1
  }

  return includeDeleted ? items : items.filter((item) => !isDeletedPrivatePost(item))
}

async function findPrivatePostsByPostName(
  postName: string,
  includeDeleted = false
): Promise<PrivatePost[]> {
  const items = await listAllPrivatePostResources(includeDeleted)
  return items.filter((item) => item.spec.postName === postName)
}

function isDeletedPrivatePost(privatePost: PrivatePost): boolean {
  return Boolean(privatePost.metadata.deletionTimestamp)
}

function bundleMatches(
  privatePost: PrivatePost,
  expectedBundle?: EncryptedPrivatePostBundle
): boolean {
  if (!expectedBundle) {
    return true
  }

  return stableStringify(privatePost.spec.bundle) === stableStringify(expectedBundle)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortRecursively(value))
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortRecursively(item))
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => [key, sortRecursively(nestedValue)])

  return Object.fromEntries(entries)
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, durationMs)
  })
}
