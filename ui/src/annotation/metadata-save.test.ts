import { describe, expect, it } from 'vitest'

function parseJson(value: string): unknown {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseMetadataPostBody(bodyText: string): {
  metadata: {
    name?: string
  }
  spec: {
    title?: string
    slug?: string
  }
} | null {
  const parsed = parseJson(bodyText)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const post = parsed as {
    metadata?: {
      name?: string
    }
    spec?: {
      title?: string
      slug?: string
    }
    content?: unknown
  }

  if (!post.spec || !post.metadata) {
    return null
  }

  if ('content' in post) {
    return null
  }

  return {
    metadata: post.metadata,
    spec: post.spec,
  }
}

function shouldManageEncryptionOnSave(args: {
  method: string
  pathname: string
  encryptionEnabled: boolean
  hasBundle: boolean
  password: string
}): boolean {
  if (!args.encryptionEnabled && !args.hasBundle && args.password.trim().length === 0) {
    return false
  }

  const normalizedMethod = args.method.toUpperCase()
  if (normalizedMethod === 'POST') {
    return args.pathname === '/apis/api.console.halo.run/v1alpha1/posts'
      || args.pathname === '/apis/content.halo.run/v1alpha1/posts'
  }

  if (normalizedMethod !== 'PUT') {
    return false
  }

  const segments = args.pathname.split('/').filter(Boolean)
  if (
    segments.length === 6
    && segments[0] === 'apis'
    && segments[1] === 'api.console.halo.run'
    && segments[2] === 'v1alpha1'
    && segments[3] === 'posts'
    && segments[5] === 'content'
  ) {
    return true
  }

  return segments.length === 5
    && segments[0] === 'apis'
    && segments[2] === 'v1alpha1'
    && segments[3] === 'posts'
    && (
      segments[1] === 'api.console.halo.run'
      || segments[1] === 'content.halo.run'
    )
}

function shouldFetchSavedContentForFirstLock(args: {
  hasBundle: boolean
  encryptionEnabled: boolean
  password: string
  contentRaw: string
  contentRendered: string
  postNameHint: string
}): boolean {
  if (!args.encryptionEnabled || args.hasBundle || args.password.trim().length === 0) {
    return false
  }

  if (args.contentRaw.trim() || args.contentRendered.trim()) {
    return false
  }

  return args.postNameHint.trim().length > 0
}

describe('metadata save encryption flow', () => {
  it('recognizes metadata save requests sent as a bare Post payload', () => {
    const payload = JSON.stringify({
      apiVersion: 'content.halo.run/v1alpha1',
      kind: 'Post',
      metadata: {
        name: 'demo-post',
      },
      spec: {
        title: 'Demo Post',
        slug: 'demo-post',
      },
    })

    expect(parseMetadataPostBody(payload)).toEqual({
      metadata: {
        name: 'demo-post',
      },
      spec: {
        title: 'Demo Post',
        slug: 'demo-post',
      },
    })
  })

  it('matches the official metadata save endpoint', () => {
    expect(shouldManageEncryptionOnSave({
      method: 'PUT',
      pathname: '/apis/content.halo.run/v1alpha1/posts/demo-post',
      encryptionEnabled: true,
      hasBundle: false,
      password: 'secret',
    })).toBe(true)
  })

  it('falls back to saved server content for first lock during metadata-only save', () => {
    expect(shouldFetchSavedContentForFirstLock({
      hasBundle: false,
      encryptionEnabled: true,
      password: 'secret',
      contentRaw: '',
      contentRendered: '',
      postNameHint: 'demo-post',
    })).toBe(true)
  })
})
