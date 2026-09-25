import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,

  // This package must run unchanged in Node, Bun, Deno and the browser, so it
  // may only rely on `fetch` and other web-standard globals.
  //
  // `platform: 'neutral'` declares that intent to the bundler but does not
  // enforce it: rolldown treats an unresolvable specifier as an *external*
  // dependency, emits `[UNRESOLVED_IMPORT]`, prints "Build complete" and exits
  // 0. Verified by building `import { readFile } from 'node:fs/promises'`
  // against this config - it warned and passed.
  platform: 'neutral',
  target: 'es2023',

  // This is the line that turns that warning into a build error.
  //
  // `tsconfig.portable.json` is the primary guard - it typechecks this package
  // with `types: []` and a WebWorker lib, so `node:fs` has no declarations to
  // resolve. This is defense in depth, and it covers one case the tsconfig
  // cannot: a node builtin reaching the bundle through a *dependency*, whose own
  // types are never checked against our portable config.
  //
  // `test/portable-build.test.ts` fails if this is removed or set to `false`.
  failOnWarn: true,

  // The dts emitter prints "TypeScript 7.0 does not yet have a stable API and is
  // experimental" on every build. That is a status report about our toolchain,
  // not a defect in this package, and `failOnWarn` would otherwise make it fatal
  // on every run. Matched on the stable part of the sentence so a TypeScript 7.1
  // wording bump does not resurrect the problem; delete this once the TypeScript
  // API stabilises and the notice stops being printed.
  suppressWarnings: ['does not yet have a stable API'],
})
