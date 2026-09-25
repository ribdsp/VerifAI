import {
  ANTHROPIC_MODELS,
  ANTHROPIC_REJECTIONS,
  ANTHROPIC_SAMPLING_COMPATIBILITY,
  type AnthropicModel,
  type AnthropicTokenizer,
  anthropicModel,
  cheaperAnthropicModels,
} from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'

function model(id: string): AnthropicModel {
  const found = anthropicModel(id)
  if (found === undefined) {
    throw new Error(`The catalog has no entry for ${id}`)
  }
  return found
}

const ids = (models: readonly AnthropicModel[]) => models.map(({ id }) => id)

const ALWAYS_ON = [
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-mythos-5-1',
  'claude-fable-5',
  'claude-mythos-5',
  'claude-mythos-preview',
]
const CLAUDE_4_5 = [
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
]
const CLAUDE_4_6 = ['claude-opus-4-6', 'claude-sonnet-4-6']
const FROM_4_7_EXCEPT_PREVIEW = [
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-mythos-5-1',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
]
const EVERY_ID = ids(ANTHROPIC_MODELS)
const except = (excluded: readonly string[]) => EVERY_ID.filter((id) => !excluded.includes(id))

type BooleanField =
  | 'rejectsSamplingParameters'
  | 'rejectsPrefill'
  | 'rejectsThinkingEnabled'
  | 'rejectsThinkingAdaptive'
  | 'rejectsThinkingDisabled'
  | 'rejectsForcedToolChoice'
  | 'stopsAtContextWindow'

/** Models not named under either list are ones the docs leave open: `undefined`. */
const BOOLEAN_FIELDS: Readonly<Record<BooleanField, { yes: string[]; no: string[] }>> = {
  rejectsSamplingParameters: {
    yes: except(['claude-mythos-5', 'claude-mythos-preview', ...CLAUDE_4_6, ...CLAUDE_4_5]),
    no: [...CLAUDE_4_6, 'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001'],
  },
  rejectsPrefill: { yes: except(CLAUDE_4_5), no: CLAUDE_4_5 },
  rejectsThinkingEnabled: {
    yes: FROM_4_7_EXCEPT_PREVIEW,
    no: ['claude-mythos-preview', ...CLAUDE_4_6, ...CLAUDE_4_5],
  },
  rejectsThinkingAdaptive: { yes: CLAUDE_4_5, no: except(CLAUDE_4_5) },
  rejectsThinkingDisabled: {
    yes: ALWAYS_ON,
    no: ['claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8'],
  },
  rejectsForcedToolChoice: {
    yes: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-mythos-5-1'],
    no: ['claude-sonnet-5', 'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8'],
  },
  stopsAtContextWindow: { yes: except(['claude-mythos-preview']), no: [] },
}

const M = 1_000_000
const K = 1000

/** ID, [input, output] USD per MTok, cache minimum, tokenizer, context window, max output. */
const NUMBERS: readonly (readonly [
  string,
  readonly [number, number] | undefined,
  number,
  AnthropicTokenizer,
  number,
  number | undefined,
])[] = [
  ['claude-fable-5-1', [10, 50], 512, 'claude-2026', M, 128 * K],
  ['claude-opus-5-5', [4, 20], 512, 'claude-2026', M, 128 * K],
  ['claude-mythos-5-1', [10, 50], 512, 'claude-2026', M, 128 * K],
  ['claude-sonnet-5', [2, 10], 1024, 'claude-2026', M, 128 * K],
  ['claude-fable-5', [10, 50], 512, 'claude-2026', M, 128 * K],
  ['claude-mythos-5', [10, 50], 512, 'claude-2026', M, 128 * K],
  ['claude-opus-5', [5, 25], 512, 'claude-2026', M, 128 * K],
  ['claude-opus-4-8', [5, 25], 1024, 'claude-2026', M, 128 * K],
  ['claude-opus-4-7', [5, 25], 2048, 'claude-2026', M, 128 * K],
  ['claude-mythos-preview', undefined, 2048, 'claude-2026', M, 128 * K],
  ['claude-opus-4-6', [5, 25], 4096, 'claude-legacy', M, 128 * K],
  ['claude-sonnet-4-6', [3, 15], 1024, 'claude-legacy', M, 128 * K],
  ['claude-opus-4-5-20251101', [5, 25], 4096, 'claude-legacy', 200 * K, undefined],
  ['claude-sonnet-4-5-20250929', [3, 15], 1024, 'claude-legacy', 200 * K, undefined],
  ['claude-haiku-4-5-20251001', [1, 5], 4096, 'claude-legacy', 200 * K, 64 * K],
]

describe('ANTHROPIC_MODELS', () => {
  it('lists every model in the Messages API enum that has a documented ID, newest first', () => {
    expect(EVERY_ID).toEqual(NUMBERS.map(([id]) => id))
  })

  it('gives every ID and alias to one model only', () => {
    const names = ANTHROPIC_MODELS.flatMap((entry) => [entry.id, ...entry.aliases.value])

    expect(new Set(names).size).toBe(names.length)
  })

  it('aliases only the dated IDs, each to its dateless form', () => {
    for (const entry of ANTHROPIC_MODELS) {
      const [alias, ...rest] = entry.aliases.value

      expect(rest).toEqual([])
      if (alias === undefined) {
        expect(entry.id).not.toMatch(/-\d{8}$/)
      } else {
        expect(entry.id).toMatch(new RegExp(`^${alias}-\\d{8}$`))
      }
    }
  })

  it("cites the Messages API enum for each ID's existence", () => {
    for (const entry of ANTHROPIC_MODELS) {
      expect(entry.idSource).toEqual({
        url: 'https://platform.claude.com/docs/en/api/messages/create',
        quote: `"${entry.id}"`,
        retrievedAt: '2026-09-24',
      })
    }
  })

  it('is frozen down to each fact value', () => {
    expect(Object.isFrozen(ANTHROPIC_MODELS)).toBe(true)
    for (const entry of ANTHROPIC_MODELS) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.aliases.value)).toBe(true)
      if (entry.pricing !== undefined) {
        expect(Object.isFrozen(entry.pricing.value)).toBe(true)
      }
    }
    const opus = model('claude-opus-5') as { id: string }
    expect(() => {
      opus.id = 'claude-haiku-4-5'
    }).toThrow(TypeError)
  })

  it('records only what the vendor documents', () => {
    const calibrations = new Set(
      ANTHROPIC_MODELS.flatMap((entry) =>
        Object.values(entry).flatMap((field: unknown) =>
          typeof field === 'object' && field !== null && 'calibration' in field
            ? [field.calibration]
            : [],
        ),
      ),
    )

    expect([...calibrations]).toEqual(['documented'])
  })

  it.each(Object.entries(BOOLEAN_FIELDS))('%s', (field, { yes, no }) => {
    for (const entry of ANTHROPIC_MODELS) {
      const expected = yes.includes(entry.id) ? true : no.includes(entry.id) ? false : undefined

      expect(entry[field as BooleanField]?.value, entry.id).toBe(expected)
    }
  })

  it.each(NUMBERS)(
    '%s prices, caches, tokenizes and limits',
    (id, price, cache, tokenizer, context, output) => {
      const entry = model(id)

      expect(entry.pricing?.value).toEqual(
        price === undefined ? undefined : { inputPerMTok: price[0], outputPerMTok: price[1] },
      )
      expect(entry.cacheMinimumTokens?.value).toBe(cache)
      expect(entry.tokenizer?.value).toBe(tokenizer)
      expect(entry.contextWindowTokens?.value).toBe(context)
      expect(entry.maxOutputTokens?.value).toBe(output)
    },
  )
})

describe('anthropicModel', () => {
  it.each([
    ['claude-opus-4-5', 'claude-opus-4-5-20251101'],
    ['claude-sonnet-4-5', 'claude-sonnet-4-5-20250929'],
    ['claude-haiku-4-5', 'claude-haiku-4-5-20251001'],
  ])('resolves the alias %s to %s', (alias, id) => {
    expect(anthropicModel(alias)).toBe(model(id))
    expect(model(id).id).toBe(id)
  })

  it.each(['claude-opus-5', 'claude-mythos-preview'])('finds the dateless ID %s', (id) => {
    expect(anthropicModel(id)?.id).toBe(id)
  })

  it.each([
    '',
    'claude-3-5-haiku',
    'CLAUDE-OPUS-5',
    ' claude-opus-5',
    'claude-opus-5-20260101',
    'gpt-4o',
  ])('returns undefined for %j', (id) => {
    expect(anthropicModel(id)).toBeUndefined()
  })
})

describe('facts a probe relies on', () => {
  it('Opus 5.5 rejects forced tool use, citing the errors page first', () => {
    const forced = model('claude-opus-5-5').rejectsForcedToolChoice

    expect(forced?.value).toBe(true)
    expect(forced?.sources[0].url).toBe('https://platform.claude.com/docs/en/api/errors')
  })

  it('Opus 5 accepts disabled thinking only up to high effort', () => {
    const disabled = model('claude-opus-5').rejectsThinkingDisabled

    expect(disabled?.value).toBe(false)
    expect(disabled?.note).toContain('`high` or below')
  })

  it('Haiku 4.5 has a 200k window, 64k output and a legacy tokenizer', () => {
    const haiku = model('claude-haiku-4-5')

    expect(haiku.contextWindowTokens?.value).toBe(200_000)
    expect(haiku.maxOutputTokens?.value).toBe(64_000)
    expect(haiku.tokenizer?.value).toBe('claude-legacy')
  })

  it('leaves Mythos Preview unpriced rather than guessing', () => {
    expect(model('claude-mythos-preview').pricing).toBeUndefined()
  })
})

describe('ANTHROPIC_REJECTIONS', () => {
  it('describes each as a 400 invalid_request_error quoting its message', () => {
    for (const rejection of Object.values(ANTHROPIC_REJECTIONS)) {
      expect(rejection.value.status).toBe(400)
      expect(rejection.value.errorType).toBe('invalid_request_error')
      expect(rejection.value.message).toBe(rejection.sources[0].quote)
    }
  })

  it('tells Mythos Preview apart from the other always-on models', () => {
    expect(ANTHROPIC_REJECTIONS.thinkingDisabledMythosPreview.value.message).not.toBe(
      ANTHROPIC_REJECTIONS.thinkingDisabled.value.message,
    )
  })

  it('has distinct messages for distinct rejections', () => {
    const messages = Object.values(ANTHROPIC_REJECTIONS).map(({ value }) => value.message)

    expect(new Set(messages).size).toBe(messages.length)
  })
})

describe('ANTHROPIC_SAMPLING_COMPATIBILITY', () => {
  it('keeps temperature 1 and top_p 0.99, never top_k', () => {
    expect(ANTHROPIC_SAMPLING_COMPATIBILITY.value).toEqual({
      acceptedTemperature: 1,
      minimumAcceptedTopP: 0.99,
      acceptsTopK: false,
    })
  })
})

describe('cheaperAnthropicModels', () => {
  it('lists the cheaper substitutes for Opus 5, cheapest first', () => {
    expect(ids(cheaperAnthropicModels('claude-opus-5'))).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-6',
      'claude-opus-5-5',
    ])
  })

  it('leaves out models at the same price', () => {
    const cheaper = ids(cheaperAnthropicModels('claude-fable-5-1'))

    expect(cheaper).not.toContain('claude-fable-5')
    expect(cheaper).not.toContain('claude-mythos-5-1')
    expect(cheaper).toContain('claude-opus-4-5-20251101')
    expect(cheaper).not.toContain('claude-mythos-preview')
  })

  it('accepts an alias', () => {
    expect(cheaperAnthropicModels('claude-sonnet-4-5')).toEqual(
      cheaperAnthropicModels('claude-sonnet-4-5-20250929'),
    )
    expect(ids(cheaperAnthropicModels('claude-sonnet-4-5'))).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5',
    ])
  })

  it.each(['claude-haiku-4-5', 'claude-mythos-preview', 'claude-3-opus', ''])(
    'is empty and frozen for %j',
    (id) => {
      const cheaper = cheaperAnthropicModels(id)

      expect(cheaper).toEqual([])
      expect(Object.isFrozen(cheaper)).toBe(true)
    },
  )

  it('returns a frozen list', () => {
    expect(Object.isFrozen(cheaperAnthropicModels('claude-opus-5'))).toBe(true)
  })
})
