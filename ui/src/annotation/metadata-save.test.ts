import { describe, expect, it } from 'vitest'

import {
  extractPublishHeadSnapshotFromUrl,
  extractHeadSnapshotFromResponse,
  extractPostNameFromResponse,
  extractPostNameFromSaveUrl,
  extractReleaseSnapshotFromResponse,
  isPostPublishRequest,
  normalizePostRouteSegmentCandidate,
  normalizeSaveRequestBodyText,
  parseContentBody,
  parseMetadataPostBody,
  bundleMetadataEquals,
  resolveManagedRefreshPlan,
  shouldManageEncryptionOnSave,
} from '@/annotation/save-request'

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

    expect(parseMetadataPostBody(payload)).toMatchObject({
      metadata: {
        name: 'demo-post',
      },
      spec: {
        title: 'Demo Post',
        slug: 'demo-post',
      },
    })
  })

  it('does not treat PostRequest payloads as metadata-only saves', () => {
    const payload = JSON.stringify({
      post: {
        metadata: {
          name: 'demo-post',
        },
        spec: {
          title: 'Demo Post',
          slug: 'demo-post',
        },
      },
      content: {
        raw: '# Demo',
      },
    })

    expect(parseMetadataPostBody(payload)).toBeNull()
  })

  it('matches the official metadata save endpoint when encryption state is dirty', () => {
    expect(shouldManageEncryptionOnSave({
      method: 'PUT',
      url: '/apis/content.halo.run/v1alpha1/posts/demo-post',
      encryptionEnabled: true,
      hasBundle: false,
      password: 'secret',
    })).toBe(true)
  })

  it('ignores save requests when there is no encryption state to persist', () => {
    expect(shouldManageEncryptionOnSave({
      method: 'PUT',
      url: '/apis/content.halo.run/v1alpha1/posts/demo-post',
      encryptionEnabled: false,
      hasBundle: false,
      password: '   ',
    })).toBe(false)
  })

  it('extracts post names from metadata and content save endpoints', () => {
    expect(extractPostNameFromSaveUrl(
      '/apis/content.halo.run/v1alpha1/posts/demo-post',
      'PUT'
    )).toBe('demo-post')
    expect(extractPostNameFromSaveUrl(
      '/apis/api.console.halo.run/v1alpha1/posts/demo%20post/content',
      'PUT'
    )).toBe('demo post')
  })

  it('does not treat editor route segments as post names', () => {
    expect(normalizePostRouteSegmentCandidate('editor')).toBe('')
    expect(normalizePostRouteSegmentCandidate('new')).toBe('')
    expect(normalizePostRouteSegmentCandidate('create')).toBe('')
    expect(normalizePostRouteSegmentCandidate('demo-post')).toBe('demo-post')
  })

  it('does not extract a post name from create requests', () => {
    expect(extractPostNameFromSaveUrl(
      '/apis/content.halo.run/v1alpha1/posts',
      'POST'
    )).toBe('')
  })

  it('extracts post names from save responses', () => {
    expect(extractPostNameFromResponse({
      metadata: {
        name: 'demo-post',
      },
    })).toBe('demo-post')
  })

  it('extracts publish snapshots from save responses', () => {
    const response = {
      spec: {
        headSnapshot: 'draft-snapshot',
        releaseSnapshot: 'released-snapshot',
      },
    }

    expect(extractReleaseSnapshotFromResponse(response)).toBe('released-snapshot')
    expect(extractHeadSnapshotFromResponse(response)).toBe('draft-snapshot')
  })

  it('normalizes content save payloads', () => {
    expect(parseContentBody(JSON.stringify({
      raw: '# Demo',
      rawType: 'markdown',
    }))).toMatchObject({
      raw: '# Demo',
      content: '',
      rawType: 'markdown',
    })
  })

})

describe('publish request detection', () => {
  it('recognizes a publish request by URL and method (PUT)', () => {
    expect(isPostPublishRequest(
      'PUT',
      '/apis/api.console.halo.run/v1alpha1/posts/demo-post/publish'
    )).toBe(true)
  })

  it('rejects publish URL with wrong method (POST)', () => {
    expect(isPostPublishRequest(
      'POST',
      '/apis/api.console.halo.run/v1alpha1/posts/demo-post/publish'
    )).toBe(false)
  })

  it('rejects non-publish PUT URLs', () => {
    expect(isPostPublishRequest(
      'PUT',
      '/apis/api.console.halo.run/v1alpha1/posts/demo-post/content'
    )).toBe(false)
    expect(isPostPublishRequest(
      'PUT',
      '/apis/api.console.halo.run/v1alpha1/posts/demo-post'
    )).toBe(false)
  })

  it('manages encryption on publish when already encrypted', () => {
    expect(shouldManageEncryptionOnSave({
      method: 'PUT',
      url: '/apis/api.console.halo.run/v1alpha1/posts/demo-post/publish',
      encryptionEnabled: true,
      hasBundle: true,
      password: '',
    })).toBe(true)
  })

  it('manages encryption on publish for first-time lock', () => {
    expect(shouldManageEncryptionOnSave({
      method: 'PUT',
      url: '/apis/api.console.halo.run/v1alpha1/posts/demo-post/publish',
      encryptionEnabled: true,
      hasBundle: false,
      password: 'secret',
    })).toBe(true)
  })

  it('skips encryption management on publish when encryption is off and no bundle exists', () => {
    expect(shouldManageEncryptionOnSave({
      method: 'PUT',
      url: '/apis/api.console.halo.run/v1alpha1/posts/demo-post/publish',
      encryptionEnabled: false,
      hasBundle: false,
      password: '',
    })).toBe(false)
  })

  it('extracts the post name from a publish URL', () => {
    expect(extractPostNameFromSaveUrl(
      '/apis/api.console.halo.run/v1alpha1/posts/demo-post/publish',
      'PUT'
    )).toBe('demo-post')
  })

  it('extracts the head snapshot from a publish URL', () => {
    expect(extractPublishHeadSnapshotFromUrl(
      '/apis/api.console.halo.run/v1alpha1/posts/demo-post/publish?headSnapshot=snapshot-2026'
    )).toBe('snapshot-2026')
  })

  it('ignores head snapshot parameters on non-publish URLs', () => {
    expect(extractPublishHeadSnapshotFromUrl(
      '/apis/api.console.halo.run/v1alpha1/posts/demo-post/content?headSnapshot=snapshot-2026'
    )).toBe('')
  })

  it('allows bodyless publish requests to enter the encryption flow', () => {
    expect(normalizeSaveRequestBodyText({
      bodyText: null,
      method: 'PUT',
      url: '/apis/api.console.halo.run/v1alpha1/posts/demo-post/publish',
    })).toBe('')
  })

  it('keeps bodyless non-publish requests out of the encryption flow', () => {
    expect(normalizeSaveRequestBodyText({
      bodyText: null,
      method: 'PUT',
      url: '/apis/api.console.halo.run/v1alpha1/posts/demo-post/content',
    })).toBeNull()
  })
})

describe('managed refresh plan (released-content contract)', () => {
  it('uses request content only when publishing', () => {
    expect(resolveManagedRefreshPlan({
      isPublishing: true,
      metadataChanged: false,
      passwordChanged: false,
    })).toEqual({ action: 'refresh', useRequestContent: true })
  })

  it('refreshes from released content (not draft) when metadata changes on a draft save', () => {
    expect(resolveManagedRefreshPlan({
      isPublishing: false,
      metadataChanged: true,
      passwordChanged: false,
    })).toEqual({ action: 'refresh', useRequestContent: false })
  })

  it('refreshes from released content when password changes on a draft save', () => {
    expect(resolveManagedRefreshPlan({
      isPublishing: false,
      metadataChanged: false,
      passwordChanged: true,
    })).toEqual({ action: 'refresh', useRequestContent: false })
  })

  it('does not touch the ciphertext when a draft save changes neither metadata nor password', () => {
    expect(resolveManagedRefreshPlan({
      isPublishing: false,
      metadataChanged: false,
      passwordChanged: false,
    })).toEqual({ action: 'none', useRequestContent: false })
  })
})

describe('bundle metadata equality', () => {
  it('treats missing optional fields as empty', () => {
    expect(bundleMetadataEquals(
      { title: 'T', slug: 's' },
      { title: 'T', slug: 's', excerpt: '', description: '', published_at: '' }
    )).toBe(true)
  })

  it('detects title and description changes', () => {
    expect(bundleMetadataEquals(
      { title: 'T', slug: 's' },
      { title: 'T2', slug: 's' }
    )).toBe(false)
    expect(bundleMetadataEquals(
      { title: 'T', slug: 's', description: 'a' },
      { title: 'T', slug: 's', description: 'b' }
    )).toBe(false)
  })
})
