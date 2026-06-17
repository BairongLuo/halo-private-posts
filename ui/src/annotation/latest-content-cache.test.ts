import type { Content } from '@halo-dev/api-client'
import { describe, expect, it } from 'vitest'

import { LatestContentCache } from './latest-content-cache'

describe('LatestContentCache', () => {
  it('stores a defensive copy of the latest saved content by post name', () => {
    const cache = new LatestContentCache()
    const content = {
      raw: '# latest draft',
      content: '<h1>latest draft</h1>',
      rawType: 'markdown',
    } as Content

    cache.remember('demo-post', content)
    content.raw = '# mutated'

    expect(cache.read('demo-post')).toMatchObject({
      raw: '# latest draft',
      content: '<h1>latest draft</h1>',
      rawType: 'markdown',
    })
  })

  it('ignores empty content payloads', () => {
    const cache = new LatestContentCache()

    cache.remember('demo-post', {
      raw: ' ',
      content: '',
      rawType: 'markdown',
    } as Content)

    expect(cache.read('demo-post')).toBeNull()
  })
})
