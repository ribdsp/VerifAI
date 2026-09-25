import * as catalog from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import * as anthropicSources from '../src/anthropic-sources.js'
import * as openaiSources from '../src/openai-sources.js'

/**
 * Checks that hold for every fact and source the package can hand out,
 * whichever export or lookup it comes through.
 */

const CALIBRATIONS: readonly catalog.Calibration[] = [
  'measured',
  'documented',
  'derived',
  'heuristic',
]

const ALLOWED_PAGES = [
  'https://platform.claude.com/docs/en/',
  'https://developers.openai.com/api/',
  'https://github.com/openai/tiktoken/blob/main/tiktoken/model.py',
]

/** Every object reachable from `roots`, each once. */
function reachable(roots: readonly unknown[]): readonly object[] {
  const seen = new Set<object>()
  const visit = (node: unknown): readonly object[] => {
    if (typeof node !== 'object' || node === null || seen.has(node)) {
      return []
    }
    seen.add(node)
    return [node, ...Object.values(node).flatMap(visit)]
  }
  return roots.flatMap(visit)
}

const isSource = (node: object): node is catalog.FactSource =>
  'url' in node && 'quote' in node && 'retrievedAt' in node

const isFact = (node: object): node is catalog.Fact<unknown> =>
  'value' in node && 'calibration' in node && 'sources' in node

const LOOKUPS = [
  ...catalog.OPENAI_CHAT_MODEL_IDS.flatMap((id) => [
    catalog.openaiEncodingFor(id),
    catalog.openaiSnapshotFor(id),
    catalog.openaiFingerprintExpectation(id),
    catalog.openaiPromptCacheFor(id),
  ]),
  ...catalog.OPENAI_PREFIX_ENCODINGS.map(({ name }) => catalog.openaiEncodingFor(`${name}x`)),
  ...catalog.ANTHROPIC_MODELS.map(({ id }) => catalog.cheaperAnthropicModels(id)),
  ...catalog.OPENAI_MODELS.map(({ id }) => catalog.cheaperOpenaiModels(id)),
]

const EVERYTHING = reachable([...Object.values(catalog), ...LOOKUPS])
const SOURCES = EVERYTHING.filter(isSource)
const FACTS = EVERYTHING.filter(isFact)

describe('package versions', () => {
  it('declares the schema and data versions', () => {
    expect(catalog.FINGERPRINTS_SCHEMA_VERSION).toBe(1)
    expect(catalog.FINGERPRINTS_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(catalog.FINGERPRINTS_VERSION).toBe('0.2.0')
  })
})

describe('every exported fact', () => {
  it('is found by the walk, so the checks below are not vacuous', () => {
    expect(FACTS.length).toBeGreaterThan(100)
    expect(SOURCES.length).toBeGreaterThan(150)
  })

  it('is frozen, as is every object inside it', () => {
    const thawed = EVERYTHING.filter((node) => !Object.isFrozen(node))

    expect(thawed).toEqual([])
  })

  it('has a known calibration, at least one source and no blank note', () => {
    for (const found of FACTS) {
      expect(CALIBRATIONS).toContain(found.calibration)
      expect(found.sources.length).toBeGreaterThan(0)
      expect(found.sources.every(isSource)).toBe(true)
      if (found.note !== undefined) {
        expect(found.note.trim()).not.toBe('')
      }
    }
  })

  it('claims no measurement, since no first-party capture ships yet', () => {
    expect(FACTS.filter(({ calibration }) => calibration === 'measured')).toEqual([])
  })
})

describe('every fact source', () => {
  it('points at a first-party page over https', () => {
    for (const { url } of SOURCES) {
      expect(new URL(url).protocol).toBe('https:')
      expect(
        ALLOWED_PAGES.some((page) => url.startsWith(page)),
        url,
      ).toBe(true)
    }
  })

  it('quotes a trimmed, non-empty passage no longer than the limit', () => {
    for (const { url, quote } of SOURCES) {
      expect(quote, url).toBe(quote.trim())
      expect(quote.length, url).toBeGreaterThan(0)
      expect(quote.length, url).toBeLessThanOrEqual(catalog.MAX_QUOTE_LENGTH)
    }
  })

  it('was retrieved no earlier than the release date', () => {
    for (const { url, retrievedAt } of SOURCES) {
      expect(retrievedAt >= catalog.RETRIEVED_AT, url).toBe(true)
    }
  })
})

describe('the source tables', () => {
  it('hold no quote that no fact cites', () => {
    const cited = new Set<object>(SOURCES)
    const written = reachable([
      ...Object.values(anthropicSources),
      ...Object.values(openaiSources),
    ]).filter(isSource)

    expect(written.filter((node) => !cited.has(node)).map(({ quote }) => quote)).toEqual([])
  })
})
