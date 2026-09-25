import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * Every cross-runtime package must fail its build on an accidental `node:` import.
 *
 * `platform: 'neutral'` looks like it does this and does not. Rolldown treats an
 * unresolvable specifier as an external dependency: it emits
 * `[UNRESOLVED_IMPORT]`, prints "Build complete" and exits 0. Only `failOnWarn`
 * promotes that to an error, so the two options are a pair and a config carrying
 * one without the other advertises a guarantee it does not keep.
 *
 * This test exists rather than a shared config module because tsdown loads
 * `tsdown.config.ts` through a native `import`, which cannot resolve a `.js`
 * specifier to a `.ts` file on our Node 20.12 floor - the extraction was tried
 * and failed with "Cannot find module ... tsdown.shared.config.js". Duplicated
 * settings plus an assertion is the honest version of that, and it is strictly
 * stronger: it also catches a *new* portable package that never had the guard.
 */

/** Options that only work as a pair, and their required values. */
const REQUIRED_OPTIONS = {
  platform: 'neutral',
  failOnWarn: true,
} as const

/**
 * The set of portable packages, read from the tsconfig that defines portability
 * rather than hardcoded here. Adding `packages/foo/src` to that file's `include`
 * is what makes `foo` portable, so deriving the list from it means a new portable
 * package is covered by this test on the same commit that makes it portable.
 */
async function portablePackageNames(): Promise<readonly string[]> {
  const raw = await readFile(new URL('../tsconfig.portable.json', import.meta.url), 'utf8')

  // `tsconfig.portable.json` is JSONC - it carries the comments explaining why
  // `types: []` is load-bearing, so `JSON.parse` would throw. The include entries
  // are all of the form `packages/<name>/src/**/*.ts`, which a line-oriented
  // match reads without needing a JSONC parser as a dependency.
  const names = [...raw.matchAll(/"packages\/([^/"]+)\/src\//g)].map((match) => match[1] ?? '')

  return [...new Set(names)]
}

describe('portable package builds', () => {
  it('derives a non-empty portable package list from tsconfig.portable.json', async () => {
    // Liveness check. If the include globs are ever reshaped, the regex stops
    // matching and every assertion below silently becomes a no-op over an empty
    // list - the same way the old lockfile licence check passed while checking
    // nothing.
    const names = await portablePackageNames()

    expect(names).toContain('core')
    expect(names).toContain('fingerprints')
  })

  it('makes an unresolved import fatal in every portable package', async () => {
    const names = await portablePackageNames()
    const offenders: string[] = []

    for (const name of names) {
      const configUrl = new URL(`../packages/${name}/tsdown.config.ts`, import.meta.url)

      // Import the config rather than scanning its text, so the assertion is
      // against the value tsdown actually receives.
      const loaded = (await import(configUrl.href)) as { default: Record<string, unknown> }
      const config = loaded.default

      for (const [option, required] of Object.entries(REQUIRED_OPTIONS)) {
        if (config[option] !== required) {
          offenders.push(
            `packages/${name}/tsdown.config.ts must set ${option}: ${JSON.stringify(required)}, got ${JSON.stringify(config[option])}`,
          )
        }
      }
    }

    expect(
      offenders,
      'Without both options a `node:` import warns and the build still succeeds',
    ).toEqual([])
  })

  it('keeps the dts toolchain notice suppressed, so failOnWarn stays usable', async () => {
    // `failOnWarn` is only sustainable because the one warning every build emits
    // is filtered. If that suppression is dropped, the build fails on a message
    // about TypeScript's API stability and the next contributor will reasonably
    // delete `failOnWarn` to get unblocked - taking the real guard with it.
    for (const name of await portablePackageNames()) {
      const configUrl = new URL(`../packages/${name}/tsdown.config.ts`, import.meta.url)
      const loaded = (await import(configUrl.href)) as { default: Record<string, unknown> }

      expect(
        loaded.default.suppressWarnings,
        `packages/${name}/tsdown.config.ts must suppress the TypeScript API-stability notice`,
      ).toEqual(['does not yet have a stable API'])
    }
  })
})
