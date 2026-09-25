import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { repoFiles, repoRoot, TEXT_EXTENSIONS } from './helpers/repo-files.js'

const thisFile = fileURLToPath(import.meta.url)

/**
 * No credential may be committed to this repository.
 *
 * This is not the generic hygiene check it looks like. Both READMEs already ask
 * contributors to send recorded fixtures, and `verifai record` - the command
 * that redacts them - does not land until Phase 7. Until then the redaction step
 * is a human remembering to do it, so the guard has to be mechanical and has to
 * exist now rather than alongside the command.
 *
 * The audience makes it sharper still: VerifAI's users are people who were sold
 * a fake API. A tool that leaked a key while proving a key was being abused
 * would be worse than no tool.
 */

interface SecretPattern {
  readonly name: string
  readonly pattern: RegExp
}

/**
 * `(?<![A-Za-z0-9])` on the prefixed forms is load-bearing: without it, `sk-`
 * matches inside ordinary words like `task-runner-<hash>` and the suite fails
 * on its own source.
 */
const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'Anthropic API key', pattern: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', pattern: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS access key id', pattern: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Z])/ },
  { name: 'GitHub token', pattern: /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Slack token', pattern: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'private key block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: 'npm registry auth token', pattern: /_authToken\s*=\s*\S/ },
]

describe('committed secrets', () => {
  it('contains no credential-shaped string in any first-party file', async () => {
    // This file necessarily contains every pattern it searches for.
    const files = (await repoFiles(TEXT_EXTENSIONS)).filter((path) => path !== thisFile)
    expect(files.length, 'the secret scan found no files to scan').toBeGreaterThan(0)

    const findings: string[] = []

    for (const file of files) {
      const contents = await readFile(file, 'utf8')

      for (const { name, pattern } of SECRET_PATTERNS) {
        const match = pattern.exec(contents)
        if (match === null) {
          continue
        }

        // Report the location and the shape, never the value: a failing CI log
        // is public, and printing the secret would finish the job of leaking it.
        const line = contents.slice(0, match.index).split('\n').length
        findings.push(`${relative(repoRoot, file)}:${line} looks like a ${name}`)
      }
    }

    expect(
      findings,
      'Remove the credential, rotate it, and redact the fixture before committing',
    ).toEqual([])
  })

  it('refuses to trust a scan that never opened a file', async () => {
    // The guard above is only as good as the traversal under it. An empty result
    // set would make it pass while checking nothing - the same failure mode that
    // left the lockfile licence check dead for months.
    const files = await repoFiles(TEXT_EXTENSIONS)
    const names = files.map((path) => relative(repoRoot, path))

    expect(names).toContain('package.json')
    expect(names).toContain('README.md')
  })
})
