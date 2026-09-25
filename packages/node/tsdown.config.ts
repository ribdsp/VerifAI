import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // The Node-only half of the engine. Everything that has to run in a browser
  // stays in `@verifai/core`; this package exists so that `node:http`, `node:dns`
  // and `node:zlib` never have to be imported from there.
  platform: 'node',
  target: 'node22.18',
  // Pinned so the files match the `exports` map. Inferred, platform `node`
  // emits `.mjs` and `.d.mts`, and `exports` would point at files never built.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // Same notice as in `@verifai/core`'s config: the TypeScript 7 dts emitter
  // reports its own experimental status on every build.
  suppressWarnings: ['does not yet have a stable API'],
})
