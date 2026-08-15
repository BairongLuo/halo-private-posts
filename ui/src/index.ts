import { definePlugin } from '@halo-dev/ui-shared'
import { markRaw } from 'vue'

import HidePasswordListState from './components/HidePasswordListState.vue'
import { installHidePasswordPanel } from './hide-password-mount'

installHidePasswordPanel()

export default definePlugin({
  extensionPoints: {
    'post:list-item:field:create': (post) => [
      {
        priority: 40,
        position: 'end',
        component: markRaw(HidePasswordListState),
        props: {
          postName: post.value.post.metadata.name,
          sourceAnnotations: post.value.post.metadata.annotations,
        },
      },
    ],
  },
})
