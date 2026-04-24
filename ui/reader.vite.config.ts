import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    emptyOutDir: true,
    outDir: 'dist-reader',
    lib: {
      entry: fileURLToPath(new URL('./src/reader.ts', import.meta.url)),
      formats: ['iife'],
      fileName: () => 'reader.js',
      name: 'HaloPrivatePostsReader',
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) =>
          assetInfo.name === 'style.css' ? 'reader.css' : '[name][extname]',
      },
    },
  },
})
