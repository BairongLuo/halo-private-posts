import { axiosInstance } from '@halo-dev/api-client'

import type { EncryptedPrivatePostBundle, PrivatePost, PrivatePostList } from '@/types/private-post'

const API_BASE = '/apis/privateposts.halo.run/v1alpha1/privateposts'

export async function listPrivatePosts(): Promise<PrivatePost[]> {
  const { data } = await axiosInstance.get<PrivatePostList>(API_BASE, {
    params: {
      page: 1,
      size: 200,
      sort: 'metadata.creationTimestamp,desc',
    },
  })
  return data.items ?? []
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

export function buildPrivatePostResource(args: {
  bundle: EncryptedPrivatePostBundle
  postName: string
  existing?: PrivatePost | null
}): PrivatePost {
  const { bundle, postName, existing } = args
  const resourceName = existing?.metadata.name ?? buildResourceName(bundle.metadata.slug, postName)

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

function buildResourceName(slug: string, postName: string): string {
  const base = `${postName}-${slug}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return base.length > 0 ? `private-post-${base}`.slice(0, 63) : 'private-post-entry'
}
