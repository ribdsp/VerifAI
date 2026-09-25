import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Bundled from source, so the UI never needs `@verifai/core` built first.
    alias: {
      '@verifai/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@verifai/fingerprints': fileURLToPath(
        new URL('../fingerprints/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Served from loopback by `verifai web`; nothing is fetched from a CDN.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
})
