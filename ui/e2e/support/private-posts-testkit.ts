import { randomUUID, webcrypto } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'

import { encryptPrivatePost } from '../../src/utils/private-post-crypto'
import type {
  DecryptedPrivatePostDocument,
  EncryptedPrivatePostBundle,
  PrivatePost,
  SiteRecoveryPublicKey,
} from '../../src/types/private-post'

export const baseURL = process.env.HALO_BASE_URL ?? 'http://localhost:8090'
export const adminUsername = process.env.HALO_E2E_USERNAME ?? 'admin'
export const adminPassword = process.env.HALO_E2E_PASSWORD ?? 'Admin12345!'
export const keepSeedData = process.env.HALO_E2E_KEEP_DATA === '1'
export const privatePostBundleAnnotation = 'privateposts.halo.run/bundle'

const adminAuthorization = `Basic ${Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64')}`
const postPublishedLabel = 'content.halo.run/published'
const requestTimeoutMs = 15_000
const defaultWaitTimeoutMs = 15_000
const defaultWaitIntervalMs = 250

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  })
}

export interface HaloPost {
  metadata: {
    name: string
    annotations?: Record<string, string>
    creationTimestamp?: string
    deletionTimestamp?: string
  }
  spec: {
    slug: string
    title: string
    publishTime?: string
  }
}

export interface SeededPrivatePost {
  name: string
  slug: string
  title: string
  body: string
  document: DecryptedPrivatePostDocument
  initialBundle: EncryptedPrivatePostBundle
  initialPassword: string
  nextPassword: string
}

export interface SeededPlainPost {
  name: string
  slug: string
  title: string
}

interface SeedPrivatePostOptions {
  publish?: boolean
  body?: string
}

export async function seedPrivatePost(
  api: APIRequestContext,
  options: SeedPrivatePostOptions = {}
): Promise<SeededPrivatePost> {
  const seedSuffix = randomUUID().slice(0, 8)
  const slug = `e2e-private-post-${seedSuffix}`
  const title = `E2E Private Post ${seedSuffix}`
  const body = options.body ?? `# ${title}\n\nSeed ${seedSuffix} for site recovery reset.`
  const publishTime = options.publish ? new Date().toISOString() : undefined
  const initialPassword = `Init#${seedSuffix}A1`
  const nextPassword = `Reset#${seedSuffix}B2`
  const createdPost = await createHaloPost(api, {
    slug,
    title,
    excerpt: `E2E excerpt ${seedSuffix}`,
    publish: options.publish ?? false,
    publishTime,
  })
  const document: DecryptedPrivatePostDocument = {
    metadata: {
      slug,
      title,
      excerpt: `E2E excerpt ${seedSuffix}`,
      published_at: publishTime ?? createdPost.metadata.creationTimestamp,
    },
    payload_format: 'markdown',
    content: body,
  }

  try {
    const siteRecoveryPublicKey = await fetchSiteRecoveryPublicKey(api)
    const initialBundle = await encryptPrivatePost(document, initialPassword, siteRecoveryPublicKey)

    await patchPrivatePostBundle(api, createdPost.metadata.name, initialBundle)
    await ensurePrivatePostMirror(api, {
      postName: createdPost.metadata.name,
      slug,
      title,
      excerpt: document.metadata.excerpt ?? '',
      publishedAt: publishTime ?? createdPost.metadata.creationTimestamp,
      bundle: initialBundle,
    })
    await waitForPrivatePost(
      api,
      createdPost.metadata.name,
      (privatePost) => stableStringify(privatePost.spec.bundle) === stableStringify(initialBundle)
    )

    return {
      name: createdPost.metadata.name,
      slug,
      title,
      body,
      document,
      initialBundle,
      initialPassword,
      nextPassword,
    }
  } catch (error) {
    await cleanupSeededPrivatePost(api, createdPost.metadata.name)
    throw error
  }
}

export async function seedPlainPost(api: APIRequestContext): Promise<SeededPlainPost> {
  const seedSuffix = randomUUID().slice(0, 8)
  const slug = `e2e-plain-post-${seedSuffix}`
  const title = `E2E Plain Post ${seedSuffix}`
  const createdPost = await createHaloPost(api, {
    slug,
    title,
    excerpt: `E2E plain excerpt ${seedSuffix}`,
    publish: false,
  })

  return {
    name: createdPost.metadata.name,
    slug,
    title,
  }
}

export async function waitForPrivatePost(
  api: APIRequestContext,
  postName: string,
  predicate: (privatePost: PrivatePost) => boolean | Promise<boolean>,
  timeoutMs = defaultWaitTimeoutMs
): Promise<PrivatePost> {
  const deadline = Date.now() + timeoutMs
  let lastSeen: PrivatePost | null = null

  while (Date.now() <= deadline) {
    const privatePost = await fetchPrivatePost(api, postName)
    if (privatePost) {
      lastSeen = privatePost
      if (await predicate(privatePost)) {
        return privatePost
      }
    }

    await delay(defaultWaitIntervalMs)
  }

  throw new Error(
    `Timed out waiting for PrivatePost ${postName}. Last seen: ${lastSeen ? stableStringify(lastSeen.spec.bundle) : 'null'}`
  )
}

export async function waitForHaloPost(
  api: APIRequestContext,
  postName: string,
  predicate: (post: HaloPost) => boolean | Promise<boolean>,
  timeoutMs = defaultWaitTimeoutMs
): Promise<HaloPost> {
  const deadline = Date.now() + timeoutMs
  let lastSeen: HaloPost | null = null

  while (Date.now() <= deadline) {
    const post = await fetchHaloPost(api, postName)
    if (post) {
      lastSeen = post
      if (await predicate(post)) {
        return post
      }
    }

    await delay(defaultWaitIntervalMs)
  }

  throw new Error(
    `Timed out waiting for Halo post ${postName}. Last seen: ${lastSeen ? stableStringify(lastSeen.metadata.annotations ?? {}) : 'null'}`
  )
}

export async function waitForUrlStatus(
  api: APIRequestContext,
  path: string,
  expectedStatus: number,
  timeoutMs = defaultWaitTimeoutMs
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastStatus: number | null = null

  while (Date.now() <= deadline) {
    const response = await api.get(path, {
      timeout: requestTimeoutMs,
    })
    lastStatus = response.status()
    if (lastStatus === expectedStatus) {
      return
    }

    await delay(defaultWaitIntervalMs)
  }

  throw new Error(`Timed out waiting for ${path} to return ${expectedStatus}. Last status: ${lastStatus}`)
}

export async function waitForPluginStatus(
  api: APIRequestContext,
  pluginName: string,
  expectedStatus: number,
  timeoutMs = defaultWaitTimeoutMs
): Promise<void> {
  await waitForUrlStatus(
    api,
    `/apis/plugin.halo.run/v1alpha1/plugins/${encodeURIComponent(pluginName)}`,
    expectedStatus,
    timeoutMs
  )
}

export async function expectNoStoreHeader(
  api: APIRequestContext,
  path: string
): Promise<void> {
  const response = await api.get(path, {
    timeout: requestTimeoutMs,
  })
  const cacheControl = response.headers()['cache-control'] ?? ''

  if (!cacheControl.includes('no-store')) {
    throw new Error(
      `Expected ${path} to return Cache-Control containing no-store, got ${cacheControl || '<missing>'}`
    )
  }
}

export async function fetchPrivatePost(
  api: APIRequestContext,
  postName: string
): Promise<PrivatePost | null> {
  const response = await api.get(
    `/apis/privateposts.halo.run/v1alpha1/privateposts/${encodeURIComponent(postName)}`,
    {
      timeout: requestTimeoutMs,
      headers: adminHeaders(),
    }
  )

  if (response.status() === 404) {
    return null
  }

  return await readJson(response, `fetch PrivatePost ${postName}`)
}

export async function fetchHaloPost(
  api: APIRequestContext,
  postName: string
): Promise<HaloPost | null> {
  const response = await api.get(
    `/apis/content.halo.run/v1alpha1/posts/${encodeURIComponent(postName)}`,
    {
      timeout: requestTimeoutMs,
      headers: adminHeaders(),
    }
  )

  if (response.status() === 404) {
    return null
  }

  return await readJson(response, `fetch Halo post ${postName}`)
}

export async function cleanupSeededPrivatePost(
  api: APIRequestContext,
  postName: string
): Promise<void> {
  if (keepSeedData) {
    return
  }

  try {
    await disablePostCommentsIfExists(api, postName)
  } catch (error) {
    console.warn(`Best-effort cleanup failed while disabling comments for ${postName}:`, error)
  }

  try {
    await deleteIfExists(api, `/apis/content.halo.run/v1alpha1/posts/${encodeURIComponent(postName)}`)
  } catch (error) {
    console.warn(`Best-effort cleanup failed while deleting source post ${postName}:`, error)
  }

  try {
    await deleteIfExists(
      api,
      `/apis/privateposts.halo.run/v1alpha1/privateposts/${encodeURIComponent(postName)}`
    )
  } catch (error) {
    console.warn(`Best-effort cleanup failed while deleting private post ${postName}:`, error)
  }
}

export async function deleteHaloPlugin(
  api: APIRequestContext,
  pluginName: string
): Promise<void> {
  const response = await api.delete(
    `/apis/plugin.halo.run/v1alpha1/plugins/${encodeURIComponent(pluginName)}`,
    {
      timeout: requestTimeoutMs,
      headers: adminHeaders(),
    }
  )

  await assertOk(response, `delete plugin ${pluginName}`)
}

async function createHaloPost(
  api: APIRequestContext,
  seed: {
    slug: string
    title: string
    excerpt: string
    publish: boolean
    publishTime?: string
  }
): Promise<HaloPost> {
  const response = await api.post('/apis/content.halo.run/v1alpha1/posts', {
    timeout: requestTimeoutMs,
    headers: adminHeaders(),
    data: {
      apiVersion: 'content.halo.run/v1alpha1',
      kind: 'Post',
      metadata: {
        generateName: 'e2e-private-post-',
        ...(seed.publish
          ? {
              labels: {
                [postPublishedLabel]: 'true',
              },
            }
          : {}),
      },
      spec: {
        allowComment: true,
        deleted: false,
        excerpt: {
          autoGenerate: false,
          raw: seed.excerpt,
        },
        owner: adminUsername,
        pinned: false,
        priority: 0,
        publish: seed.publish,
        ...(seed.publishTime ? { publishTime: seed.publishTime } : {}),
        slug: seed.slug,
        title: seed.title,
        visible: 'PUBLIC',
      },
    },
  })

  return await readJson(response, 'create Halo post')
}

async function fetchSiteRecoveryPublicKey(api: APIRequestContext): Promise<SiteRecoveryPublicKey> {
  const response = await api.get('/apis/api.console.halo.run/v1alpha1/private-posts/site-recovery-key', {
    timeout: requestTimeoutMs,
    headers: adminHeaders(),
  })
  return await readJson(response, 'fetch site recovery public key')
}

async function patchPrivatePostBundle(
  api: APIRequestContext,
  postName: string,
  bundle: EncryptedPrivatePostBundle
): Promise<void> {
  const response = await api.patch(
    `/apis/content.halo.run/v1alpha1/posts/${encodeURIComponent(postName)}`,
    {
      timeout: requestTimeoutMs,
      headers: adminHeaders({
        'Content-Type': 'application/json-patch+json',
      }),
      data: [
        {
          op: 'add',
          path: '/metadata/annotations',
          value: {
            [privatePostBundleAnnotation]: JSON.stringify(bundle),
          },
        },
      ],
    }
  )

  await assertOk(response, 'patch private post bundle')
}

async function ensurePrivatePostMirror(
  api: APIRequestContext,
  resource: {
    postName: string
    slug: string
    title: string
    excerpt: string
    publishedAt?: string
    bundle: EncryptedPrivatePostBundle
  }
): Promise<void> {
  const existing = await fetchPrivatePost(api, resource.postName)
  if (existing) {
    return
  }

  const response = await api.post('/apis/privateposts.halo.run/v1alpha1/privateposts', {
    timeout: requestTimeoutMs,
    headers: adminHeaders(),
    data: {
      apiVersion: 'privateposts.halo.run/v1alpha1',
      kind: 'PrivatePost',
      metadata: {
        name: resource.postName,
      },
      spec: {
        postName: resource.postName,
        slug: resource.slug,
        title: resource.title,
        excerpt: resource.excerpt,
        publishedAt: resource.publishedAt,
        bundle: resource.bundle,
      },
    },
  })

  if (response.status() === 409) {
    return
  }

  await assertOk(response, `create PrivatePost mirror ${resource.postName}`)
}

async function deleteIfExists(api: APIRequestContext, path: string): Promise<void> {
  const response = await api.delete(path, {
    timeout: requestTimeoutMs,
    headers: adminHeaders(),
  })
  if (response.status() === 404) {
    return
  }

  await assertOk(response, `delete ${path}`)
}

async function disablePostCommentsIfExists(
  api: APIRequestContext,
  postName: string
): Promise<void> {
  const response = await api.patch(
    `/apis/content.halo.run/v1alpha1/posts/${encodeURIComponent(postName)}`,
    {
      timeout: requestTimeoutMs,
      headers: adminHeaders({
        'Content-Type': 'application/json-patch+json',
      }),
      data: [
        {
          op: 'replace',
          path: '/spec/allowComment',
          value: false,
        },
      ],
    }
  )

  if (response.status() === 404) {
    return
  }

  await assertOk(response, `disable comments for ${postName}`)
}

async function readJson<T>(response: APIResponse, action: string): Promise<T> {
  await assertOk(response, action)
  return (await response.json()) as T
}

async function assertOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return
  }

  throw new Error(`${action} failed with ${response.status()}: ${await response.text()}`)
}

function adminHeaders(headers?: Record<string, string>): Record<string, string> {
  return {
    Authorization: adminAuthorization,
    ...(headers ?? {}),
  }
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

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, durationMs)
  })
}
