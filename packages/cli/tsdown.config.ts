import { access, cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const WEB_DIST = fileURLToPath(new URL('../web/dist/', import.meta.url))
const WEB_OUT = fileURLToPath(new URL('./dist/web/', import.meta.url))

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  // A binary has no importers, so type declarations would be dead weight.
  dts: false,
  clean: true,
  platform: 'node',
  target: 'node20.12',
  // Pinned rather than inferred. tsdown derives the extension from the
  // `exports` map, which a bin-only package does not have, and defaults to
  // `.mjs` - leaving `bin` pointing at a file that was never emitted, which
  // surfaces as a broken symlink on `npm i -g` rather than a build error.
  outExtensions: () => ({ js: '.js' }),
  // `verifai web` serves the built page from next to `bin.js`. A package
  // built without it would install fine and fail on first use, so a missing
  // page fails the build instead.
  onSuccess: async () => {
    try {
      await access(`${WEB_DIST}index.html`)
    } catch {
      throw new Error('Build @verifai/web first: packages/web/dist/index.html is missing.')
    }
    await cp(WEB_DIST, WEB_OUT, { recursive: true })
  },
})
