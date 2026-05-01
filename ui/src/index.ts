import { definePlugin } from '@halo-dev/ui-shared'
import { markRaw } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

import { installPrivatePostAnnotationTool } from './annotation/mount'
import PostPrivateBodyField from './components/PostPrivateBodyField.vue'
import PrivatePostsView from './views/PrivatePostsView.vue'

const PRIVATE_POST_BUNDLE_ANNOTATION = 'privateposts.halo.run/bundle'

installPrivatePostAnnotationTool()

export default definePlugin({
  components: {},
  extensionPoints: {
    'post:list-item:field:create': (post) => [
      {
        priority: 40,
        position: 'end',
        component: markRaw(PostPrivateBodyField),
        props: {
          postName: post.value.post.metadata.name,
          sourceAnnotationsPresent: typeof post.value.post.metadata.annotations !== 'undefined',
          sourceBundleText: post.value.post.metadata.annotations?.[PRIVATE_POST_BUNDLE_ANNOTATION] ?? '',
        },
      },
    ],
  },
  routes: [
    {
      parentName: 'Root',
      route: {
        path: '/private-post',
        redirect: (to: RouteLocationNormalizedLoaded) => ({
          name: 'HaloPrivatePosts',
          query: to.query,
        }),
      },
    },
    {
      parentName: 'Root',
      route: {
        path: '/private-posts',
        name: 'HaloPrivatePosts',
        component: PrivatePostsView,
        meta: {
          title: '平台恢复重置口令',
          searchable: false,
        },
      },
    },
  ],
})
