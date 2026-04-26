import { consoleApiClient, coreApiClient } from '@halo-dev/api-client'
import type { ContentWrapper, JsonPatchInner, ListedPost, Post } from '@halo-dev/api-client'

export interface HaloPostSummary {
  name: string
  title: string
  slug: string
  excerpt: string
  publishTime?: string
  permalink?: string
  visible?: string
}

export interface HaloPostContent {
  raw: string
  content: string
  rawType?: string
}

const PRIVATE_POST_BUNDLE_ANNOTATION = 'privateposts.halo.run/bundle'
const PRIVATE_POST_BUNDLE_ANNOTATION_PATH = '/metadata/annotations/privateposts.halo.run~1bundle'
const POST_DELETED_LABEL = 'content.halo.run/deleted'

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

export async function isHaloPostActive(name: string): Promise<boolean> {
  try {
    const { data: post } = await coreApiClient.content.post.getPost({ name })
    return !(
      post.spec.deleted
      || post.metadata.deletionTimestamp
      || post.metadata.labels?.[POST_DELETED_LABEL] === 'true'
    )
  } catch {
    return false
  }
}

export async function fetchHaloPostHeadContent(name: string): Promise<HaloPostContent> {
  const { data } = await consoleApiClient.content.post.fetchPostHeadContent({ name })
  return mapContentWrapper(data)
}

export async function persistPrivatePostBundleAnnotation(
  name: string,
  bundleText: string
): Promise<void> {
  const { data: post } = await coreApiClient.content.post.getPost({ name })
  const annotations = post.metadata.annotations ?? {}
  const hasAnnotation = Object.prototype.hasOwnProperty.call(
    annotations,
    PRIVATE_POST_BUNDLE_ANNOTATION
  )
  const normalizedBundleText = bundleText.trim()
  let patch: JsonPatchInner[] = []

  if (normalizedBundleText) {
    patch = post.metadata.annotations
      ? [
          {
            op: hasAnnotation ? 'replace' : 'add',
            path: PRIVATE_POST_BUNDLE_ANNOTATION_PATH,
            value: normalizedBundleText,
          },
        ]
      : [
          {
            op: 'add',
            path: '/metadata/annotations',
            value: {
              [PRIVATE_POST_BUNDLE_ANNOTATION]: normalizedBundleText,
            },
          },
        ]
  } else if (hasAnnotation) {
    patch = [
      {
        op: 'remove',
        path: PRIVATE_POST_BUNDLE_ANNOTATION_PATH,
      },
    ]
  }

  if (patch.length === 0) {
    return
  }

  await coreApiClient.content.post.patchPost({
    name,
    jsonPatchInner: patch,
  })
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

function mapContentWrapper(content: ContentWrapper): HaloPostContent {
  return {
    raw: content.raw ?? '',
    content: content.content ?? '',
    rawType: content.rawType ?? undefined,
  }
}
