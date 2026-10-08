import { defineConfig } from 'vite'

export default defineConfig({
  // relative base so the build works from any folder or sub-path
  base: './',
  server: { host: true },
  preview: { host: true },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
  },
})
