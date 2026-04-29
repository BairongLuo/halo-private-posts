import { randomUUID } from 'node:crypto'
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test'

import { decryptPrivatePost } from '../src/utils/private-post-crypto'
import type { EncryptedPrivatePostBundle } from '../src/types/private-post'
import {
  adminPassword,
  adminUsername,
  baseURL,
  cleanupSeededPrivatePost,
  expectNoStoreHeader,
  seedPlainPost,
  seedPrivatePost,
  type SeededPlainPost,
  type SeededPrivatePost,
  waitForPrivatePost,
  waitForUrlStatus,
} from './support/private-posts-testkit'

test.describe('Halo Private Posts e2e', () => {
  test('does not show the encryption entry in the posts list menu', async ({ page, request }) => {
    test.slow()

    let seededPrivatePost: SeededPrivatePost | null = null

    try {
      seededPrivatePost = await seedPrivatePost(request, {
        body: `Menu secret body ${randomUUID().slice(0, 8)}`,
      })

      await loginToConsole(page)
      await openPostsListPage(page)

      const row = page.getByRole('row', {
        name: new RegExp(`${escapeRegExp(seededPrivatePost.title)}[\\s\\S]*已加锁`),
      })
      await expect(row).toBeVisible()

      await row.locator('.entity-dropdown-trigger').click()
      await expect(page.getByText('文章加密', { exact: true })).toHaveCount(0)
    } finally {
      if (seededPrivatePost) {
        await cleanupSeededPrivatePost(request, seededPrivatePost.name)
      }
    }
  })

  test('opens the standalone editor panel when the unlocked status tag is clicked', async ({ page, request }) => {
    test.slow()

    let seededPlainPost: SeededPlainPost | null = null

    try {
      seededPlainPost = await seedPlainPost(request)

      await loginToConsole(page)
      await openPostsListPage(page)

      const row = page.getByRole('row', {
        name: new RegExp(`${escapeRegExp(seededPlainPost.title)}[\\s\\S]*未加锁`),
      })
      await expect(row).toBeVisible()

      await Promise.all([
        page.waitForURL(
          new RegExp(`/console/posts/editor\\?name=${escapeRegExp(seededPlainPost.name)}(?:$|&)`)
        ),
        row.getByRole('button', { name: '未加锁' }).click(),
      ])

      await expect(page).not.toHaveURL(/hppOpenEncryption=/)
      await expect(page.locator('[data-hpp-standalone-shell]')).toBeVisible()
      await expect(page.locator('[data-hpp-standalone-content]')).toBeVisible()
      await expect(page.getByText('独立于 Settings 的编辑页加密面板')).toHaveCount(0)
    } finally {
      if (seededPlainPost) {
        await cleanupSeededPrivatePost(request, seededPlainPost.name)
      }
    }
  })

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
        body: `Reader secret body ${randomUUID().slice(0, 8)}`,
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
      await expect(publicPage.getByText('输入访问密码后，正文会在浏览器本地解密。')).toHaveCount(0)

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
  await page.goto('/console/private-posts')
  await expect(page).toHaveURL(/\/console\/(?:#\/)?private-posts(?:\?|$)/)
  await expect(page.getByRole('heading', { name: '平台恢复重置口令' })).toBeVisible()
  await expect(page.getByRole('button', { name: '刷新列表' })).toBeVisible()
  await expect(page.getByText('这是临时保留的后台恢复页')).toBeVisible()
}

async function openPostsListPage(page: Page): Promise<void> {
  await page.goto('/console/posts')
  await expect(page).toHaveURL(/\/console\/posts(?:\?|$)/)
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, durationMs)
  })
}
