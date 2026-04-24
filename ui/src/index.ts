import { IconPlug } from '@halo-dev/components'
import { definePlugin } from '@halo-dev/console-shared'
import { markRaw } from 'vue'

import PostPrivateBodyField from './components/PostPrivateBodyField.vue'
import PrivatePostsView from './views/PrivatePostsView.vue'

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
  },
  routes: [
    {
      parentName: 'Root',
      route: {
        path: '/private-posts',
        name: 'HaloPrivatePosts',
        component: PrivatePostsView,
        meta: {
          title: '私密文章',
          searchable: true,
          menu: {
            name: '私密文章',
            group: '内容',
            icon: markRaw(IconPlug),
            priority: 0,
          },
        },
      },
    },
  ],
})
