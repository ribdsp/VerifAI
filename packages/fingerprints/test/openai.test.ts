import {
  OPENAI_CHAT_MODEL_IDS,
  OPENAI_EXACT_ENCODINGS,
  OPENAI_PREFIX_ENCODINGS,
  openaiEncodingFor,
  openaiFingerprintExpectation,
  openaiPromptCacheFor,
  openaiSnapshotFor,
} from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { FINGERPRINT, TIKTOKEN_LOOKUP } from '../src/openai-sources.js'

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Expected a value for ${what}`)
  }
  return value
}

describe('OPENAI_CHAT_MODEL_IDS', () => {
  it('lists the 88 values of the Chat Completions enum once each', () => {
    expect(OPENAI_CHAT_MODEL_IDS).toHaveLength(88)
    expect(new Set(OPENAI_CHAT_MODEL_IDS).size).toBe(88)
    expect(OPENAI_CHAT_MODEL_IDS.slice(0, 3)).toEqual(['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna'])
    expect(OPENAI_CHAT_MODEL_IDS.at(-1)).toBe('gpt-3.5-turbo-16k-0613')
  })

  it('is frozen', () => {
    expect(Object.isFrozen(OPENAI_CHAT_MODEL_IDS)).toBe(true)
  })
})

describe('tiktoken tables', () => {
  it.each([
    ['exact', OPENAI_EXACT_ENCODINGS],
    ['prefix', OPENAI_PREFIX_ENCODINGS],
  ])('names each %s rule once and freezes it', (_, table) => {
    const names = table.map(({ name }) => name)

    expect(new Set(names).size).toBe(names.length)
    expect(Object.isFrozen(table)).toBe(true)
    expect(table.every((rule) => Object.isFrozen(rule))).toBe(true)
  })
})

describe('openaiEncodingFor', () => {
  it.each([
    ['gpt-4o', 'o200k_base'],
    ['gpt-5', 'o200k_base'],
    ['o4-mini', 'o200k_base'],
    ['gpt-4', 'cl100k_base'],
    ['gpt-3.5-turbo', 'cl100k_base'],
  ])('matches %s exactly before any prefix', (id, encoding) => {
    const found = defined(openaiEncodingFor(id), id)

    expect(found.value).toBe(encoding)
    expect(found.calibration).toBe('derived')
    expect(found.sources[0].quote).toBe(`"${id}": "${encoding}"`)
    expect(found.sources[1]).toBe(TIKTOKEN_LOOKUP.exactFirst)
  })

  it.each([
    ['gpt-4o-2024-08-06', 'gpt-4o-', 'o200k_base'],
    ['gpt-4o-mini', 'gpt-4o-', 'o200k_base'],
    ['gpt-5.5', 'gpt-5', 'o200k_base'],
    ['gpt-5.6-terra', 'gpt-5', 'o200k_base'],
    ['gpt-4.1-mini', 'gpt-4.1-', 'o200k_base'],
    ['gpt-4.5-preview', 'gpt-4.5-', 'o200k_base'],
    ['o3-mini', 'o3-', 'o200k_base'],
    ['chatgpt-4o-latest', 'chatgpt-4o-', 'o200k_base'],
    ['gpt-4-0613', 'gpt-4-', 'cl100k_base'],
    ['gpt-4-turbo', 'gpt-4-', 'cl100k_base'],
    ['gpt-3.5-turbo-16k', 'gpt-3.5-turbo-', 'cl100k_base'],
    ['gpt-oss-20b', 'gpt-oss-', 'o200k_harmony'],
    ['ft:gpt-4o-mini:acme::run1', 'ft:gpt-4o', 'o200k_base'],
    ['ft:gpt-4-0613:acme::run1', 'ft:gpt-4', 'cl100k_base'],
  ])('maps %s through the %s prefix', (id, prefix, encoding) => {
    const found = defined(openaiEncodingFor(id), id)

    expect(found.value).toBe(encoding)
    expect(found.sources[0].quote).toBe(`"${prefix}": "${encoding}"`)
    expect(found.sources[1]).toBe(TIKTOKEN_LOOKUP.firstPrefix)
  })

  it.each(['gpt-6-astra', 'codex-mini-latest', 'gpt-audio-mini', 'GPT-4O', 'claude-opus-5', ''])(
    'has no encoding for %j',
    (id) => {
      expect(openaiEncodingFor(id)).toBeUndefined()
    },
  )

  it('places every enum ID except the gpt-6, audio and codex models', () => {
    const unplaced = OPENAI_CHAT_MODEL_IDS.filter((id) => openaiEncodingFor(id) === undefined)

    expect(unplaced).toEqual([
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-audio-mini',
      'gpt-audio-mini-2025-12-15',
      'codex-mini-latest',
    ])
  })
})

describe('openaiSnapshotFor', () => {
  it('lists the dated IDs under an alias', () => {
    const found = defined(openaiSnapshotFor('gpt-4o'), 'gpt-4o')
    const candidates = ['gpt-4o-2024-11-20', 'gpt-4o-2024-08-06', 'gpt-4o-2024-05-13']

    expect(found.value).toEqual({ kind: 'alias', alias: 'gpt-4o', candidates })
    expect(found.calibration).toBe('heuristic')
    expect(found.sources.map(({ quote }) => quote)).toEqual(
      ['gpt-4o', ...candidates].map((id) => `"${id}"`),
    )
    expect(Object.isFrozen(found.value)).toBe(true)
  })

  it.each([
    ['gpt-4', ['gpt-4-0314', 'gpt-4-0613']],
    [
      'gpt-3.5-turbo',
      ['gpt-3.5-turbo-0301', 'gpt-3.5-turbo-0613', 'gpt-3.5-turbo-1106', 'gpt-3.5-turbo-0125'],
    ],
    ['gpt-4o-mini', ['gpt-4o-mini-2024-07-18']],
    ['gpt-5.4-mini', ['gpt-5.4-mini-2026-03-17']],
  ])('keeps %s apart from longer aliases that share its prefix', (alias, candidates) => {
    expect(openaiSnapshotFor(alias)?.value).toEqual({ kind: 'alias', alias, candidates })
  })

  it.each([
    ['gpt-4o-2024-08-06', 'gpt-4o'],
    ['gpt-4-0613', 'gpt-4'],
    ['gpt-3.5-turbo-16k-0613', 'gpt-3.5-turbo-16k'],
    ['gpt-5.5-2026-04-23', 'gpt-5.5'],
  ])('pins the dated ID %s under %s', (id, alias) => {
    const found = defined(openaiSnapshotFor(id), id)

    expect(found.value).toEqual({ kind: 'pinned', alias, echo: id })
    expect(found.calibration).toBe('heuristic')
    expect(found.sources.map(({ quote }) => quote)).toEqual([`"${id}"`])
  })

  it.each(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.4', 'chatgpt-4o-latest', 'gpt-4-0125-preview'])(
    'has no snapshot for the enum ID %s, which lists no dated form',
    (id) => {
      expect(openaiSnapshotFor(id)).toBeUndefined()
    },
  )

  it.each(['gpt-4o-2099-01-01', 'gpt-7', ''])('has no snapshot for %j outside the enum', (id) => {
    expect(openaiSnapshotFor(id)).toBeUndefined()
  })
})

describe('openaiFingerprintExpectation', () => {
  it('allows null or an fp_ value for every enum ID', () => {
    for (const id of OPENAI_CHAT_MODEL_IDS) {
      const found = defined(openaiFingerprintExpectation(id), id)

      expect(found.value.mayBeNull).toBe(true)
      expect(found.calibration).toBe('heuristic')
    }
  })

  it("matches the reference's own examples and nothing looser", () => {
    const pattern = new RegExp(
      defined(openaiFingerprintExpectation('gpt-4o'), 'gpt-4o').value.pattern,
    )
    const examples = [FINGERPRINT.streamExample, FINGERPRINT.example].map(({ quote }) =>
      defined(/"(fp_[^"]+)"/.exec(quote)?.[1], quote),
    )

    for (const example of examples) {
      expect(pattern.test(example)).toBe(true)
    }
    expect(pattern.test('fp_44709d6fc')).toBe(false)
    expect(pattern.test('fp_44709d6fcb0')).toBe(false)
    expect(pattern.test('xfp_44709d6fcb')).toBe(false)
  })

  it.each(['claude-opus-5', 'gpt-7', ''])('has no expectation for %j', (id) => {
    expect(openaiFingerprintExpectation(id)).toBeUndefined()
  })
})

describe('openaiPromptCacheFor', () => {
  it.each(['gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'])(
    'gives %s the 1,024-token minimum and exact reporting',
    (id) => {
      const found = defined(openaiPromptCacheFor(id), id)

      expect(found.value).toEqual({ minimumTokens: 1024, cachedTokensMultiple: 1 })
      expect(found.calibration).toBe('documented')
    },
  )

  it.each([
    'gpt-5.5',
    'gpt-5.5-2026-04-23',
    'gpt-5',
    'gpt-4o',
    'o3',
    'chatgpt-4o-latest',
    'codex-mini-latest',
  ])('gives the earlier model %s no fixed minimum and 128-token rounding', (id) => {
    expect(openaiPromptCacheFor(id)?.value).toEqual({
      minimumTokens: undefined,
      cachedTokensMultiple: 128,
    })
  })

  it.each(['gpt-5.6', 'gpt-7', ''])('knows nothing about %j outside the enum', (id) => {
    expect(openaiPromptCacheFor(id)).toBeUndefined()
  })
})
