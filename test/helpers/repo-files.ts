import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Shared repository walk for the guard suites in `test/`.
 *
 * Two of those suites - the clean-room licensing check and the secret scan -
 * need to read every first-party file in the tree. They had no business each
 * carrying their own copy of the traversal, because a fix to one copy (a skipped
 * directory, a missed extension) silently leaves the other one weaker.
 */

/** Absolute path to the repository root. */
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Generated, package-manager-owned, or otherwise not ours to audit. `.git` is
 * skipped because its objects are zlib-compressed: scanning them finds nothing
 * and is not fast.
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.verifai',
])

/** First-party source and manifests. */
export const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.json',
])

/** Everything a committed credential could plausibly hide in. */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ...CODE_EXTENSIONS,
  '.md',
  '.yaml',
  '.yml',
  '.har',
  '.jsonl',
  '.txt',
  '.sh',
  '.toml',
  // `.env.example` ends in `.example`; the real `.env` is gitignored but a
  // developer running the suite locally may still have one on disk.
  '.env',
  '.example',
])

/**
 * Files worth scanning whose name carries no useful extension. `.npmrc` is the
 * classic place a registry `_authToken` ends up.
 */
export const ALWAYS_SCAN_BASENAMES: ReadonlySet<string> = new Set([
  '.npmrc',
  'Dockerfile',
  'Makefile',
])

/** Every file in the repository matching `extensions`, as absolute paths. */
export async function repoFiles(extensions: ReadonlySet<string>): Promise<string[]> {
  const found: string[] = []

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(absolute)
        }
        continue
      }

      const dot = entry.name.lastIndexOf('.')
      const byExtension = dot > 0 && extensions.has(entry.name.slice(dot))
      if (byExtension || ALWAYS_SCAN_BASENAMES.has(entry.name)) {
        found.push(absolute)
      }
    }
  }

  await walk(repoRoot)
  return found
}
