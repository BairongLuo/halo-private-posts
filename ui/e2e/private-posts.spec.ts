import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test'

import {
  decryptPrivatePost,
  encryptPrivatePost,
} from '../src/utils/private-post-crypto'
import type {
  DecryptedPrivatePostDocument,
  EncryptedPrivatePostBundle,
  PrivatePost,
  SiteRecoveryPublicKey,
} from '../src/types/private-post'

const baseURL = process.env.HALO_BASE_URL ?? 'http://localhost:8090'
const adminUsername = process.env.HALO_E2E_USERNAME ?? 'admin'
const adminPassword = process.env.HALO_E2E_PASSWORD ?? 'Admin12345!'
const adminAuthorization = `Basic ${Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64')}`
const keepSeedData = process.env.HALO_E2E_KEEP_DATA === '1'
const privatePostBundleAnnotation = 'privateposts.halo.run/bundle'
const postPublishedLabel = 'content.halo.run/published'
const requestTimeoutMs = 15_000
const defaultWaitTimeoutMs = 15_000
const defaultWaitIntervalMs = 250

interface HaloPost {
  metadata: {
    name: string
    creationTimestamp?: string
  }
  spec: {
    slug: string
    title: string
    publishTime?: string
  }
}

interface SeededPrivatePost {
  name: string
  slug: string
  title: string
  body: string
  document: DecryptedPrivatePostDocument
  initialBundle: EncryptedPrivatePostBundle
  initialPassword: string
  nextPassword: string
}

interface SeedPrivatePostOptions {
  publish?: boolean
  body?: string
}

test.describe('Halo Private Posts e2e', () => {
  test('logs in as console admin and resets a seeded private post password', async ({ page, request }) => {
    test.slow()

    await openConsoleRoot(page)
    await expect(page).toHaveURL(/\/login(?:\?|$)/)
    await expect(page.locator('#login-form')).toBeVisible()

    await loginToConsole(page)
    await openPrivatePostsPage(page)

    let seededPrivatePost: SeededPrivatePost | null = null

    try {
      seededPrivatePost = await seedPrivatePost(request)
      await page.getByRole('button', { name: '刷新列表' }).click()
      await expect(
        page.getByRole('button', { name: seededPrivatePost.title, exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: seededPrivatePost.title, exact: true }).click()

      await expect(page).toHaveURL(
        new RegExp(`/console/(?:#/)?private-posts\\?.*postName=${seededPrivatePost.name}`)
      )
      await expect(page.getByRole('heading', { name: seededPrivatePost.title })).toBeVisible()

      await page.getByLabel('新的访问口令', { exact: true }).fill(seededPrivatePost.nextPassword)
      await page.getByLabel('确认新的访问口令', { exact: true }).fill(seededPrivatePost.nextPassword)
      await page.getByRole('button', { name: '使用平台恢复能力重置口令' }).click()

      await expect(page.getByText('访问口令已通过平台恢复能力重置。')).toBeVisible()

      const updatedPrivatePost = await waitForPrivatePost(
        request,
        seededPrivatePost.name,
        (privatePost) => hasBundleChanged(privatePost.spec.bundle, seededPrivatePost.initialBundle)
      )

      await expect(
        decryptPrivatePost(updatedPrivatePost.spec.bundle, seededPrivatePost.initialPassword)
      ).rejects.toThrow(/访问密码错误/)

      await expect(
        decryptPrivatePost(updatedPrivatePost.spec.bundle, seededPrivatePost.nextPassword)
      ).resolves.toMatchObject(seededPrivatePost.document)
    } finally {
      if (seededPrivatePost) {
        await cleanupSeededPrivatePost(request, seededPrivatePost.name)
      }
    }
  })

  test('unlocks a published private post from the standalone reader page', async ({ browser, request }) => {
    test.slow()

    let seededPrivatePost: SeededPrivatePost | null = null
    let publicContext: BrowserContext | null = null

    try {
      seededPrivatePost = await seedPrivatePost(request, {
        publish: true,
        body: `Reader secret body ${crypto.randomUUID().slice(0, 8)}`,
      })
      await waitForUrlStatus(
        request,
        `/private-posts/data?slug=${encodeURIComponent(seededPrivatePost.slug)}`,
        200
      )
      await waitForUrlStatus(
        request,
        `/private-posts?slug=${encodeURIComponent(seededPrivatePost.slug)}`,
        200
      )
      await expectNoStoreHeader(
        request,
        `/private-posts/data?slug=${encodeURIComponent(seededPrivatePost.slug)}`
      )
      await expectNoStoreHeader(
        request,
        `/private-posts?slug=${encodeURIComponent(seededPrivatePost.slug)}`
      )

      publicContext = await browser.newContext({
        baseURL,
      })

      const publicPage = await publicContext.newPage()
      await publicPage.goto(`/private-posts?slug=${encodeURIComponent(seededPrivatePost.slug)}`)

      await expect(publicPage.getByRole('heading', { name: seededPrivatePost.title })).toBeVisible()
      await expect(publicPage.getByText('输入访问密码后，正文会在浏览器本地解密。')).toBeVisible()

      await publicPage.getByLabel('访问密码').fill(`${seededPrivatePost.initialPassword}-wrong`)
      await publicPage.getByRole('button', { name: '用密码解锁' }).click()
      await expect(publicPage.getByText('访问密码错误，或密文已损坏')).toBeVisible()

      await publicPage.getByLabel('访问密码').fill(seededPrivatePost.initialPassword)
      await publicPage.getByRole('button', { name: '用密码解锁' }).click()

      await expect(publicPage.locator('[data-hpp-lock-panel]')).toBeHidden()
      await expect(publicPage.locator('[data-hpp-content]')).toContainText(seededPrivatePost.body)
    } finally {
      await publicContext?.close()
      if (seededPrivatePost) {
        await cleanupSeededPrivatePost(request, seededPrivatePost.name)
      }
    }
  })
})

async function openConsoleRoot(page: Page): Promise<void> {
  await page.goto('/console/')
}

async function loginToConsole(page: Page): Promise<void> {
  await openConsoleRoot(page)

  if (/\/login(?:\?|$)/.test(page.url())) {
    await page.fill('#username', adminUsername)
    await page.fill('#plainPassword', adminPassword)
    await page.getByRole('button', { name: 'Login' }).click()
  }

  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

async function openPrivatePostsPage(page: Page): Promise<void> {
  await page.getByText('私密文章', { exact: true }).click()
  await expect(page).toHaveURL(/\/console\/(?:#\/)?private-posts(?:\?|$)/)
  await expect(page.getByRole('heading', { name: '私密文章口令维护' })).toBeVisible()
  await expect(page.getByRole('button', { name: '刷新列表' })).toBeVisible()
  await expect(page.getByText('后台只保留平台恢复重置入口')).toBeVisible()
}

async function seedPrivatePost(
  api: APIRequestContext,
  options: SeedPrivatePostOptions = {}
): Promise<SeededPrivatePost> {
  const seedSuffix = crypto.randomUUID().slice(0, 8)
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

async function waitForPrivatePost(
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

async function waitForUrlStatus(
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

async function expectNoStoreHeader(
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

async function fetchPrivatePost(
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

async function cleanupSeededPrivatePost(
  api: APIRequestContext,
  postName: string
): Promise<void> {
  if (keepSeedData) {
    return
  }

  await deleteIfExists(api, `/apis/content.halo.run/v1alpha1/posts/${encodeURIComponent(postName)}`)
  await deleteIfExists(
    api,
    `/apis/privateposts.halo.run/v1alpha1/privateposts/${encodeURIComponent(postName)}`
  )
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

function hasBundleChanged(
  nextBundle: EncryptedPrivatePostBundle,
  previousBundle: EncryptedPrivatePostBundle
): boolean {
  return stableStringify(nextBundle) !== stableStringify(previousBundle)
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
