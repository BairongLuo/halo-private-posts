import { definePlugin } from '@halo-dev/ui-shared'
import { markRaw } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

import { installPrivatePostAnnotationTool } from './annotation/mount'
import PostEncryptionOperationItem from './components/PostEncryptionOperationItem.vue'
import PostPrivateBodyField from './components/PostPrivateBodyField.vue'
import { openPostEncryptionEditor } from './utils/open-post-encryption-editor'
import PrivatePostsView from './views/PrivatePostsView.vue'

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
        },
      },
    ],
    'post:list-item:operation:create': (post) => [
      {
        priority: 85,
        component: markRaw(PostEncryptionOperationItem),
        props: {
          onSelect: () => {
            openPostEncryptionEditor(post.value.post.metadata.name)
          },
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
