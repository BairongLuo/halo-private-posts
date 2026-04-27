import { axiosInstance } from '@halo-dev/api-client'
import type { AxiosError } from 'axios'

import { getHaloPostLockState } from '@/api/posts'
import type { EncryptedPrivatePostBundle, PrivatePost, PrivatePostList } from '@/types/private-post'

const API_BASE = '/apis/privateposts.halo.run/v1alpha1/privateposts'
const DEFAULT_LIST_PAGE_SIZE = 200

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

export async function createPrivatePost(privatePost: PrivatePost): Promise<PrivatePost> {
  const { data } = await axiosInstance.post<PrivatePost>(API_BASE, privatePost)
  return data
}

export async function updatePrivatePost(privatePost: PrivatePost): Promise<PrivatePost> {
  const { data } = await axiosInstance.put<PrivatePost>(
    `${API_BASE}/${privatePost.metadata.name}`,
    privatePost
  )
  return data
}

export async function deletePrivatePost(name: string): Promise<void> {
  await axiosInstance.delete(`${API_BASE}/${name}`)
}

export async function deletePrivatePostByPostName(postName: string): Promise<void> {
  const privatePosts = await findPrivatePostsByPostName(postName, true)
  for (const privatePost of privatePosts) {
    await deletePrivatePostPermanently(privatePost.metadata.name)
  }
}

export async function upsertPrivatePostByPostName(args: {
  bundle: EncryptedPrivatePostBundle
  postName: string
}): Promise<PrivatePost> {
  return await upsertPrivatePostByPostNameWithRetry(args, 1)
}

async function upsertPrivatePostByPostNameWithRetry(args: {
  bundle: EncryptedPrivatePostBundle
  postName: string
}, retriesLeft: number): Promise<PrivatePost> {
  await purgeDeletedPrivatePostsByPostName(args.postName)
  const existing = await findPrivatePostByPostName(args.postName)
  const privatePost = buildPrivatePostResource({
    bundle: args.bundle,
    postName: args.postName,
    existing,
  })

  try {
    return existing ? await updatePrivatePost(privatePost) : await createPrivatePost(privatePost)
  } catch (error) {
    if (retriesLeft > 0 && isRetryableWriteError(error)) {
      return await upsertPrivatePostByPostNameWithRetry(args, retriesLeft - 1)
    }

    throw error
  }
}

export function buildPrivatePostResource(args: {
  bundle: EncryptedPrivatePostBundle
  postName: string
  existing?: PrivatePost | null
}): PrivatePost {
  const { bundle, postName, existing } = args
  const resourceName = existing?.metadata.name ?? postName

  return {
    apiVersion: 'privateposts.halo.run/v1alpha1',
    kind: 'PrivatePost',
    metadata: {
      name: resourceName,
      ...(existing?.metadata.version ? { version: existing.metadata.version } : {}),
    },
    spec: {
      postName,
      slug: bundle.metadata.slug,
      title: bundle.metadata.title,
      excerpt: bundle.metadata.excerpt,
      publishedAt: bundle.metadata.published_at,
      bundle,
    },
  }
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

async function purgeDeletedPrivatePostsByPostName(postName: string): Promise<void> {
  const privatePosts = await findPrivatePostsByPostName(postName, true)
  for (const privatePost of privatePosts) {
    if (!isDeletedPrivatePost(privatePost)) {
      continue
    }

    await deletePrivatePostIfPresent(privatePost.metadata.name)
    await deletePrivatePostIfPresent(privatePost.metadata.name)
  }
}

async function deletePrivatePostPermanently(name: string): Promise<void> {
  await deletePrivatePostIfPresent(name)
  await deletePrivatePostIfPresent(name)
}

async function deletePrivatePostIfPresent(name: string): Promise<void> {
  const response = await axiosInstance.delete(`${API_BASE}/${name}`, {
    validateStatus: (status) => {
      return status === 404 || (typeof status === 'number' && status >= 200 && status < 300)
    },
  })

  if (response.status === 404) {
    return
  }
}

function isDeletedPrivatePost(privatePost: PrivatePost): boolean {
  return Boolean(privatePost.metadata.deletionTimestamp)
}

function isNotFoundError(error: unknown): boolean {
  return extractResponseStatus(error) === 404 || /(?:^|[\s.])not found(?:$|[\s.])|was not found/i.test(
    extractErrorMessage(error)
  )
}

function isConflictError(error: unknown): boolean {
  return extractResponseStatus(error) === 409
}

function isRetryableWriteError(error: unknown): boolean {
  return isNotFoundError(error) || isConflictError(error)
}

function extractResponseStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const candidate = error as AxiosError & {
    status?: unknown
  }

  if (typeof candidate.response?.status === 'number') {
    return candidate.response.status
  }

  return typeof candidate.status === 'number' ? candidate.status : undefined
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  if (typeof error !== 'object' || error === null) {
    return ''
  }

  const candidate = error as {
    message?: unknown
    response?: {
      data?: {
        detail?: unknown
        title?: unknown
      }
    }
  }

  if (typeof candidate.message === 'string') {
    return candidate.message
  }

  if (typeof candidate.response?.data?.detail === 'string') {
    return candidate.response.data.detail
  }

  if (typeof candidate.response?.data?.title === 'string') {
    return candidate.response.data.title
  }

  return ''
}
