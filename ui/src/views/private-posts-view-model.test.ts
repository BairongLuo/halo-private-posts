import { describe, expect, it } from 'vitest'

import {
  canResetWithSiteRecovery,
  formatTimestamp,
  readQueryString,
  resolveSelectedArticleSlug,
  resolveSelectedArticleTitle,
  resolveSiteRecoveryAvailability,
  toMessage,
} from './private-posts-view-model'

describe('private-posts-view-model', () => {
  it('normalizes route query strings', () => {
    expect(readQueryString(['hello'])).toBe('hello')
    expect(readQueryString([''])).toBe('')
    expect(readQueryString('world')).toBe('world')
    expect(readQueryString(null)).toBe('')
  })

  it('resolves selected article text with sensible fallbacks', () => {
    expect(resolveSelectedArticleTitle(
      { title: 'Halo Title', slug: 'halo-title' } as never,
      { spec: { title: 'Mirror Title', slug: 'mirror-slug' } } as never,
      'route-slug'
    )).toBe('Halo Title')

    expect(resolveSelectedArticleTitle(
      null,
      { spec: { title: 'Mirror Title', slug: 'mirror-slug' } } as never,
      'route-slug'
    )).toBe('Mirror Title')

    expect(resolveSelectedArticleTitle(null, null, 'route-slug')).toBe('route-slug')

    expect(resolveSelectedArticleSlug(
      { slug: 'halo-title' } as never,
      { spec: { title: 'Mirror Title', slug: 'mirror-slug' } } as never
    )).toBe('halo-title')

    expect(resolveSelectedArticleSlug(null, null)).toBe('')
  })

  it('describes the current site recovery availability', () => {
    expect(resolveSiteRecoveryAvailability('', null)).toBe('先从列表选中一篇文章。')
    expect(resolveSiteRecoveryAvailability('demo-post', null)).toBe('当前文章还没有同步出私密正文。')
    expect(resolveSiteRecoveryAvailability('demo-post', {
      spec: {
        bundle: {
          site_recovery_slot: {
            kid: 'recovery',
          },
        },
      },
    } as never)).toBe('输入新口令后，平台会直接重写 password slot。')
    expect(resolveSiteRecoveryAvailability('demo-post', {
      spec: {
        bundle: {},
      },
    } as never)).toBe('当前文章缺少有效的平台恢复槽。请重新加锁后再使用平台恢复。')
  })

  it('checks whether site recovery reset can proceed', () => {
    expect(canResetWithSiteRecovery(null, 'next', 'next')).toBe(false)
    expect(canResetWithSiteRecovery({
      spec: {
        bundle: {},
      },
    } as never, 'next', 'next')).toBe(false)
    expect(canResetWithSiteRecovery({
      spec: {
        bundle: {
          site_recovery_slot: {
            kid: 'recovery',
          },
        },
      },
    } as never, 'next', 'next')).toBe(true)
    expect(canResetWithSiteRecovery({
      spec: {
        bundle: {
          site_recovery_slot: {
            kid: 'recovery',
          },
        },
      },
    } as never, ' next ', 'next')).toBe(true)
    expect(canResetWithSiteRecovery({
      spec: {
        bundle: {
          site_recovery_slot: {
            kid: 'recovery',
          },
        },
      },
    } as never, '   ', 'next')).toBe(false)
  })

  it('formats timestamps and errors consistently', () => {
    expect(formatTimestamp()).toBe('未设置')
    expect(formatTimestamp('not-a-date')).toBe('not-a-date')
    expect(toMessage(new Error('boom'))).toBe('boom')
    expect(toMessage('plain error')).toBe('未知错误')
  })
})
