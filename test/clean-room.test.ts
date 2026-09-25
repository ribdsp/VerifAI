import { readdir, readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CODE_EXTENSIONS, repoFiles, repoRoot } from './helpers/repo-files.js'

const thisFile = fileURLToPath(import.meta.url)

/**
 * VerifAI is MIT licensed with zero third-party detection code. That is a
 * licensing commitment, not a preference: pulling in an AGPL detection engine
 * would relicense this project permanently, and copying one would make the
 * provenance claim in the README false.
 *
 * These tests make the commitment mechanical instead of aspirational.
 */

/**
 * Packages that must never appear anywhere in the dependency graph.
 *
 * `ai-model-verifier` is AGPL-3.0-only. Anything else added here should come
 * with a one-line reason, because a denylist nobody understands gets deleted.
 *
 * Matching is deliberately plain substring containment rather than an anchored
 * `name@version` pattern. The earlier anchored form (`/${name}@`) was written
 * for pnpm lockfile v6, silently stopped matching when v9 dropped the leading
 * slash from package keys, and passed for months while checking nothing. On a
 * denylist of specific, unusual package names, over-matching (a hypothetical
 * `ai-model-verifier-fork`) is the safe direction to be wrong in.
 */
const FORBIDDEN_DEPENDENCIES: readonly string[] = ['ai-model-verifier']

/**
 * Copyleft markers that must not appear in our own source. A dependency's
 * license lives in `node_modules`, which this scan skips; one of these strings
 * inside the tree means a file was copied in, which is the exact failure mode
 * `README.md` promises against ("not as a dependency, not as a reference").
 */
const COPYLEFT_MARKERS: readonly string[] = [
  'GNU AFFERO GENERAL PUBLIC LICENSE',
  'GNU GENERAL PUBLIC LICENSE',
  'AGPL-3.0',
]

/** Utility dependencies are fine; a detection engine is not. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

async function readPackageJson(relativePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    throw new Error(`${relativePath} is not valid JSON: ${(error as Error).message}`)
  }
}

async function packageJsonPaths(): Promise<string[]> {
  const packagesDir = new URL('../packages/', import.meta.url)
  const entries = await readdir(packagesDir, { withFileTypes: true })
  return [
    '../package.json',
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => `../packages/${entry.name}/package.json`),
  ]
}

/**
 * Every first-party code file in the repository, excluding this test.
 *
 * Prose is deliberately out of scope. `README.md` and `docs/PROVENANCE.md`
 * *must* name the forbidden package to record why it was rejected, so scanning
 * `.md` would fail on the provenance record itself. Naming it in prose is the
 * audit trail; naming it in code is the contamination.
 */
async function codeFiles(): Promise<string[]> {
  const found = await repoFiles(CODE_EXTENSIONS)

  // This file necessarily contains every forbidden string it searches for.
  return found.filter((path) => path !== thisFile)
}

describe('clean-room licensing invariants', () => {
  it('declares MIT in the root manifest and ships a matching LICENSE file', async () => {
    const root = await readPackageJson('../package.json')
    const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8')

    expect(root.license).toBe('MIT')
    expect(license).toContain('MIT License')
    expect(license).toContain('Permission is hereby granted, free of charge')
  })

  it('names a real copyright holder instead of the MIT template placeholder', async () => {
    // An unfilled template makes the grant ambiguous, which for a repository
    // whose entire value proposition is auditable provenance is not cosmetic.
    const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8')

    for (const placeholder of ['<YEAR>', '<COPYRIGHT HOLDER>', '[year]', '[fullname]']) {
      expect(license, `LICENSE still contains the placeholder ${placeholder}`).not.toContain(
        placeholder,
      )
    }
    expect(license).toMatch(/Copyright \(c\) \d{4} \S/)
  })

  it('publishes every workspace package under MIT', async () => {
    const paths = (await packageJsonPaths()).filter((path) => path !== '../package.json')
    expect(paths.length).toBeGreaterThan(0)

    for (const path of paths) {
      const manifest = await readPackageJson(path)
      expect(manifest.license, `${path} must declare its license`).toBe('MIT')
    }
  })

  it('never declares a third-party detection implementation, under any alias', async () => {
    for (const path of await packageJsonPaths()) {
      const manifest = await readPackageJson(path)

      for (const field of DEPENDENCY_FIELDS) {
        const declared = Object.entries((manifest[field] as Record<string, string>) ?? {})

        for (const [name, specifier] of declared) {
          for (const forbidden of FORBIDDEN_DEPENDENCIES) {
            expect(name, `${path} -> ${field} must not depend on ${forbidden}`).not.toContain(
              forbidden,
            )
            // `"detector": "npm:ai-model-verifier@1.0.0"` hides the package in
            // the *value*, so checking keys alone is not enough.
            expect(
              specifier,
              `${path} -> ${field}.${name} must not alias ${forbidden}`,
            ).not.toContain(forbidden)
          }
        }
      }
    }
  })

  it('does not mention a forbidden package anywhere in the lockfile', async () => {
    // A transitive edge would relicense the project just as effectively as a
    // direct one, so the check has to look past the manifests. The lockfile is
    // committed, so a missing one is a broken checkout, not a fresh clone -
    // let `readFile` throw rather than skipping the assertion.
    const lockfile = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')

    // Liveness check. Without it, any change to the lockfile format (or an
    // empty file) turns every assertion below into a no-op that still reports
    // green - which is precisely what happened to the previous version of this
    // test. `vitest` must be resolvable here because it is running this code.
    expect(lockfile, 'pnpm-lock.yaml does not look like a populated lockfile').toContain('vitest')

    for (const forbidden of FORBIDDEN_DEPENDENCIES) {
      expect(lockfile, `${forbidden} must not appear in pnpm-lock.yaml`).not.toContain(forbidden)
    }
  })

  it('does not vendor a forbidden implementation into our own source', async () => {
    // The dependency graph is only half the commitment. README.md promises the
    // forbidden engine is used "not as a dependency, not as a reference", and
    // copy-pasting it in would leave the manifests and lockfile spotless.
    const files = await codeFiles()
    expect(files.length, 'the source scan found no files to scan').toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const forbidden of FORBIDDEN_DEPENDENCIES) {
        if (source.includes(forbidden)) {
          offenders.push(`${relative(repoRoot, file)} mentions ${forbidden}`)
        }
      }
    }

    expect(offenders, 'Forbidden detection code may not be vendored into the tree').toEqual([])
  })

  it('carries no copyleft license header in first-party source', async () => {
    const offenders: string[] = []

    for (const file of await codeFiles()) {
      const source = (await readFile(file, 'utf8')).toUpperCase()
      for (const marker of COPYLEFT_MARKERS) {
        if (source.includes(marker)) {
          offenders.push(`${relative(repoRoot, file)} contains "${marker}"`)
        }
      }
    }

    expect(offenders, 'A copyleft header in our tree means a file was copied in').toEqual([])
  })

  it('keeps the repository root readable so the provenance claim can be audited', async () => {
    const entries = await readdir(repoRoot)
    expect(entries).toContain('LICENSE')
    expect(entries).toContain('docs')
  })
})
