import type { Content, Post, PostRequest } from '@halo-dev/api-client'

export type PendingSaveAction = 'none' | 'lock' | 'unlock' | 'refresh'

export function resolvePendingSaveAction(args: {
  encryptionEnabled: boolean
  hasBundle: boolean
}): PendingSaveAction {
  if (!args.encryptionEnabled && args.hasBundle) {
    return 'unlock'
  }

  if (args.encryptionEnabled && !args.hasBundle) {
    return 'lock'
  }

  if (args.encryptionEnabled && args.hasBundle) {
    return 'refresh'
  }

  return 'none'
}

export function shouldManageEncryptionOnSave(args: {
  method: string
  url: string
  encryptionEnabled: boolean
  hasBundle: boolean
  password: string
}): boolean {
  if (!args.encryptionEnabled && !args.hasBundle && args.password.trim().length === 0) {
    return false
  }

  const pathname = parseRequestPathname(args.url)
  if (!pathname) {
    return false
  }

  const normalizedMethod = args.method.toUpperCase()
  if (normalizedMethod === 'POST') {
    return pathname === '/apis/api.console.halo.run/v1alpha1/posts'
      || pathname === '/apis/content.halo.run/v1alpha1/posts'
  }

  if (normalizedMethod !== 'PUT') {
    return false
  }

  if (isPostContentSavePath(pathname)) {
    return true
  }

  const segments = pathname.split('/').filter(Boolean)
  return segments.length === 5
    && segments[0] === 'apis'
    && (
      (
        segments[1] === 'api.console.halo.run'
        && segments[2] === 'v1alpha1'
        && segments[3] === 'posts'
      )
      || (
        segments[1] === 'content.halo.run'
        && segments[2] === 'v1alpha1'
        && segments[3] === 'posts'
      )
    )
}

export function isPostContentSaveRequest(method: string, url: string): boolean {
  return method.toUpperCase() === 'PUT' && isPostContentSavePath(parseRequestPathname(url))
}

export function isPostContentSavePath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  return segments.length === 6
    && segments[0] === 'apis'
    && segments[1] === 'api.console.halo.run'
    && segments[2] === 'v1alpha1'
    && segments[3] === 'posts'
    && segments[5] === 'content'
}

export function parsePostRequestBody(bodyText: string): PostRequest | null {
  const parsed = parseJson(bodyText)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const postRequest = parsed as Partial<PostRequest>
  if (!postRequest.post || !postRequest.content) {
    return null
  }

  return postRequest as PostRequest
}

export function parseMetadataPostBody(bodyText: string): Post | null {
  const parsed = parseJson(bodyText)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const post = parsed as Partial<Post>
  if (!post.spec || !post.metadata) {
    return null
  }

  if ('content' in (parsed as Record<string, unknown>)) {
    return null
  }

  return post as Post
}

export function parseContentBody(bodyText: string): Content | null {
  const parsed = parseJson(bodyText)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const content = parsed as Partial<Content>
  if (typeof content.raw !== 'string' && typeof content.content !== 'string') {
    return null
  }

  return {
    raw: typeof content.raw === 'string' ? content.raw : '',
    content: typeof content.content === 'string' ? content.content : '',
    rawType: typeof content.rawType === 'string' ? content.rawType : '',
  } as Content
}

export function extractPostNameFromSaveUrl(url: string, method: string): string {
  if (method.toUpperCase() === 'POST') {
    return ''
  }

  const pathname = parseRequestPathname(url)
  const segments = pathname.split('/').filter(Boolean)
  if (
    segments.length === 5
    && segments[0] === 'apis'
    && segments[2] === 'v1alpha1'
    && segments[3] === 'posts'
    && (
      segments[1] === 'api.console.halo.run'
      || segments[1] === 'content.halo.run'
    )
  ) {
    return decodeURIComponent(segments[4] ?? '')
  }

  if (isPostContentSavePath(pathname)) {
    return decodeURIComponent(segments[4] ?? '')
  }

  return ''
}

export function extractPostNameFromResponse(responseData: unknown): string {
  if (!responseData || typeof responseData !== 'object') {
    return ''
  }

  const metadata = (responseData as { metadata?: { name?: unknown } }).metadata
  return typeof metadata?.name === 'string' ? metadata.name : ''
}

export function parseRequestPathname(url: string): string {
  try {
    return new URL(url, currentOrigin()).pathname
  } catch {
    return ''
  }
}

export function parseJson(value: string): unknown {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function currentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }

  return 'http://localhost'
}
