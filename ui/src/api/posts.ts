import { consoleApiClient, coreApiClient } from '@halo-dev/api-client'
import type { ListedPost, Post } from '@halo-dev/api-client'

export interface HaloPostSummary {
  name: string
  title: string
  slug: string
  excerpt: string
  publishTime?: string
  permalink?: string
  visible?: string
}

export async function listHaloPosts(keyword = ''): Promise<HaloPostSummary[]> {
  const { data } = await consoleApiClient.content.post.listPosts({
    page: 1,
    size: 12,
    keyword: keyword.trim() || undefined,
    sort: ['spec.publishTime,desc', 'metadata.creationTimestamp,desc'],
  })

  return (data.items ?? []).map((item) => mapListedPostToSummary(item))
}

export async function getHaloPostByName(name: string): Promise<HaloPostSummary> {
  const { data } = await coreApiClient.content.post.getPost({ name })
  return mapPostToSummary(data)
}

function mapListedPostToSummary(listedPost: ListedPost): HaloPostSummary {
  return mapPostToSummary(listedPost.post)
}

function mapPostToSummary(post: Post): HaloPostSummary {
  return {
    name: post.metadata.name,
    title: post.spec.title,
    slug: post.spec.slug,
    excerpt: post.spec.excerpt?.raw ?? post.status?.excerpt ?? '',
    publishTime: post.spec.publishTime ?? undefined,
    permalink: post.status?.permalink ?? undefined,
    visible: post.spec.visible,
  }
}
