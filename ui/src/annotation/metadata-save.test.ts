import { describe, expect, it } from 'vitest'

import {
  extractPostNameFromResponse,
  extractPostNameFromSaveUrl,
  parseContentBody,
  parseMetadataPostBody,
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

  it('extracts post names from save responses', () => {
    expect(extractPostNameFromResponse({
      metadata: {
        name: 'demo-post',
      },
    })).toBe('demo-post')
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
