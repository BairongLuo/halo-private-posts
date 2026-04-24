import { fileURLToPath, URL } from 'node:url'

import { viteConfig } from '@halo-dev/ui-plugin-bundler-kit'

export default viteConfig({
  vite: {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
})
