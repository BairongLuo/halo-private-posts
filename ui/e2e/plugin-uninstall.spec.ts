import { expect, test } from '@playwright/test'

import {
  cleanupSeededPrivatePost,
  deleteHaloPlugin,
  fetchHaloPost,
  fetchPrivatePost,
  privatePostBundleAnnotation,
  seedPrivatePost,
  type SeededPrivatePost,
  waitForHaloPost,
  waitForPluginStatus,
} from './support/private-posts-testkit'

const pluginName = process.env.HALO_PLUGIN_NAME ?? 'halo-private-posts'

test.describe('Halo Private Posts uninstall smoke @destructive', () => {
  test('clears source annotations before the plugin is fully removed', async ({ request }) => {
    test.slow()

    let seededPrivatePost: SeededPrivatePost | null = null

    try {
      seededPrivatePost = await seedPrivatePost(request, {
        publish: true,
      })

      const sourcePostBeforeDelete = await fetchHaloPost(request, seededPrivatePost.name)
      expect(sourcePostBeforeDelete).not.toBeNull()
      expect(
        sourcePostBeforeDelete?.metadata.annotations?.[privatePostBundleAnnotation]
      ).toBeTruthy()
      expect(await fetchPrivatePost(request, seededPrivatePost.name)).not.toBeNull()

      await deleteHaloPlugin(request, pluginName)
      await waitForPluginStatus(request, pluginName, 404)

      const unlockedPost = await waitForHaloPost(
        request,
        seededPrivatePost.name,
        (post) => !post.metadata.annotations?.[privatePostBundleAnnotation]
      )

      expect(unlockedPost.metadata.annotations?.[privatePostBundleAnnotation]).toBeUndefined()
      expect(await fetchPrivatePost(request, seededPrivatePost.name)).toBeNull()
    } finally {
      if (seededPrivatePost) {
        await cleanupSeededPrivatePost(request, seededPrivatePost.name)
      }
    }
  })
})
