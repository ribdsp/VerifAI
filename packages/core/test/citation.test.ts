import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { citation, MAX_QUOTE_LENGTH } from '../src/sources/citation.js'

describe('citation', () => {
  it('builds a frozen citation with a trimmed quote', () => {
    const built = citation('https://example.com/docs', '  A sentence.  ', '2026-09-24')

    expect(built).toEqual({
      url: 'https://example.com/docs',
      quote: 'A sentence.',
      retrievedAt: '2026-09-24',
    })
    expect(Object.isFrozen(built)).toBe(true)
  })

  it.each([
    ['a relative URL', 'docs/errors', 'q', '2026-09-24'],
    ['a plain http URL', 'http://example.com', 'q', '2026-09-24'],
    ['an empty quote', 'https://example.com', '   ', '2026-09-24'],
    ['an overlong quote', 'https://example.com', 'x'.repeat(MAX_QUOTE_LENGTH + 1), '2026-09-24'],
    ['a date that is not ISO', 'https://example.com', 'q', '24/09/2026'],
    ['a month that does not exist', 'https://example.com', 'q', '2026-13-01'],
  ])('refuses %s', (_label, url, quote, date) => {
    expect(() => citation(url, quote, date)).toThrow(TypeError)
  })
})

/**
 * Every module in `sources/` but the builder, loaded by name so a probe author
 * who adds `sources/anthropic-caching.ts` is covered without touching this
 * test. The prefix of the file name says whose documentation it may cite.
 */
const SOURCES_DIR = new URL('../src/sources/', import.meta.url)

const HOSTS: Readonly<Record<string, RegExp>> = {
  anthropic: /^https:\/\/platform\.claude\.com\/docs\//,
  openai: /^https:\/\/developers\.openai\.com\/api\//,
  measured: /^https:\/\/github\.com\/ribdsp\/VerifAI\/blob\/main\/docs\//,
  papers: /^https:\/\/arxiv\.org\/abs\//,
}

async function catalogue(): Promise<readonly (readonly [string, unknown])[]> {
  const files = (await readdir(SOURCES_DIR)).filter(
    (name) => name.endsWith('.ts') && name !== 'citation.ts',
  )
  const modules = await Promise.all(
    files.map(async (name) => {
      const loaded: Record<string, unknown> = await import(new URL(name, SOURCES_DIR).href)
      return Object.values(loaded).map((entry) => [name, entry] as const)
    }),
  )
  return modules.flat()
}

describe('the citation catalogue', () => {
  it('exports only citations', async () => {
    const all = await catalogue()
    expect(all.length).toBeGreaterThan(0)
    for (const [, entry] of all) {
      expect(entry).toEqual({
        url: expect.stringMatching(/^https:\/\//),
        quote: expect.any(String),
        retrievedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    }
  })

  it('cites each source from the host its file name promises', async () => {
    for (const [name, entry] of await catalogue()) {
      const prefix = name.split(/[-.]/)[0] ?? ''
      const host = HOSTS[prefix]
      expect(host, `${name} has no known source prefix`).toBeDefined()
      expect((entry as { url: string }).url).toMatch(host as RegExp)
    }
  })

  it('never cites the same quote twice under different names', async () => {
    const seen = new Map<string, string>()
    for (const [name, entry] of await catalogue()) {
      const { url, quote } = entry as { url: string; quote: string }
      const key = `${url}
${quote}`
      expect(seen.get(key), `${name} repeats a citation`).toBeUndefined()
      seen.set(key, name)
    }
  })
})
