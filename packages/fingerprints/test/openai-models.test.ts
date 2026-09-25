import {
  cheaperOpenaiModels,
  OPENAI_MODELS,
  type OpenAIModel,
  openaiModel,
} from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'

function model(id: string): OpenAIModel {
  const found = openaiModel(id)
  if (found === undefined) {
    throw new Error(`The catalog has no entry for ${id}`)
  }
  return found
}

const ids = (models: readonly OpenAIModel[]) => models.map(({ id }) => id)

const GPT_5_FAMILY = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano']
const GPT_5_1_UP = ['gpt-5.2', 'gpt-5.1']
const GPT_6 = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']
const EVERY_ID = ids(OPENAI_MODELS)

type BooleanField =
  | 'rejectsNoneEffort'
  | 'rejectsSamplingAtNoneEffort'
  | 'rejectsSamplingAtOtherEffort'

/** Models not named under either list are ones the docs leave open: `undefined`. */
const BOOLEAN_FIELDS: Readonly<Record<BooleanField, { yes: string[]; no: string[] }>> = {
  rejectsNoneEffort: { yes: ['gpt-6-astra'], no: [...GPT_5_1_UP, 'gpt-6-sol', 'gpt-6-luna'] },
  rejectsSamplingAtNoneEffort: { yes: GPT_5_FAMILY, no: GPT_5_1_UP },
  rejectsSamplingAtOtherEffort: { yes: [...GPT_5_1_UP, ...GPT_5_FAMILY], no: [] },
}

describe('OPENAI_MODELS', () => {
  it('lists the reasoning models whose effort and sampling rules the guides settle', () => {
    expect(EVERY_ID).toEqual([...GPT_6, ...GPT_5_1_UP, ...GPT_5_FAMILY])
  })

  it('finds each model by ID and by its default snapshot', () => {
    expect(model('gpt-5.2-2025-12-11').id).toBe('gpt-5.2')
    expect(model('gpt-5.1-2025-11-13').id).toBe('gpt-5.1')
    expect(model('gpt-5-2025-08-07').id).toBe('gpt-5')
    expect(model('gpt-5-mini-2025-08-07').id).toBe('gpt-5-mini')
    expect(model('gpt-5-nano-2025-08-07').id).toBe('gpt-5-nano')
    for (const id of EVERY_ID) {
      expect(model(id).id).toBe(id)
    }
  })

  it('gives a GPT-6 model no snapshot besides its own ID', () => {
    for (const id of GPT_6) {
      expect(model(id).snapshots.value).toEqual([])
      expect(model(id).snapshots.sources[0].quote).toBe(`Default snapshot: \`${id}\``)
    }
  })

  it('knows nothing it was not told', () => {
    for (const id of ['gpt-5.2-pro', 'gpt-5.2-chat-latest', 'gpt-5.5', 'gpt-4o', '', 'GPT-5.2']) {
      expect(openaiModel(id)).toBeUndefined()
    }
  })

  it.each(Object.entries(BOOLEAN_FIELDS))('reads %s as documented', (field, { yes, no }) => {
    for (const id of EVERY_ID) {
      const found = model(id)[field as BooleanField]
      const expected = yes.includes(id) ? true : no.includes(id) ? false : undefined
      expect(found?.value, `${id} ${field}`).toBe(expected)
      if (found !== undefined) {
        expect(found.calibration).toBe('documented')
      }
    }
  })

  it('accepts `low` effort on every model, so a request at `low` is a fair control', () => {
    for (const { id, reasoningEfforts } of OPENAI_MODELS) {
      expect(reasoningEfforts.value, id).toContain('low')
    }
  })

  it('lists `none` only where the page does, and never for GPT-6 Astra', () => {
    const withNone = OPENAI_MODELS.filter(({ reasoningEfforts }) =>
      reasoningEfforts.value.includes('none'),
    )
    expect(ids(withNone)).toEqual(['gpt-6-sol', 'gpt-6-luna', 'gpt-5.2', 'gpt-5.1'])
  })

  it('names a default effort only where the page does', () => {
    const defaults = Object.fromEntries(
      OPENAI_MODELS.map(({ id, defaultReasoningEffort }) => [id, defaultReasoningEffort?.value]),
    )
    expect(defaults).toEqual({
      'gpt-6-astra': undefined,
      'gpt-6-sol': 'medium',
      'gpt-6-luna': 'medium',
      'gpt-5.2': 'none',
      'gpt-5.1': 'none',
      'gpt-5': undefined,
      'gpt-5-mini': undefined,
      'gpt-5-nano': undefined,
    })
  })

  it('cites the HTTP 400 for GPT-6 Astra at effort `none`', () => {
    const quotes = model('gpt-6-astra').rejectsNoneEffort?.sources.map(({ quote }) => quote)
    expect(quotes?.[0]).toContain('to `none` returns HTTP 400.')
  })

  it('prices each model per million tokens, from its own page', () => {
    const prices = Object.fromEntries(OPENAI_MODELS.map(({ id, pricing }) => [id, pricing?.value]))
    expect(prices).toEqual({
      'gpt-6-astra': { inputPerMTok: 10, outputPerMTok: 50 },
      'gpt-6-sol': { inputPerMTok: 2, outputPerMTok: 10 },
      'gpt-6-luna': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
      'gpt-5.2': { inputPerMTok: 1.75, outputPerMTok: 14 },
      'gpt-5.1': { inputPerMTok: 1.25, outputPerMTok: 10 },
      'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10 },
      'gpt-5-mini': { inputPerMTok: 0.25, outputPerMTok: 2 },
      'gpt-5-nano': { inputPerMTok: 0.05, outputPerMTok: 0.4 },
    })
    for (const { id, pricing } of OPENAI_MODELS) {
      expect(
        pricing?.sources.every(({ url }) => url.endsWith(`/docs/models/${id}`)),
        id,
      ).toBe(true)
    }
  })

  it('is frozen, entries and all', () => {
    expect(Object.isFrozen(OPENAI_MODELS)).toBe(true)
    for (const entry of OPENAI_MODELS) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.reasoningEfforts.value)).toBe(true)
    }
  })
})

describe('cheaperOpenaiModels', () => {
  it('lists the cheaper substitutes for GPT-5.2, cheapest first', () => {
    expect(ids(cheaperOpenaiModels('gpt-5.2'))).toEqual([
      'gpt-5-nano',
      'gpt-6-luna',
      'gpt-5-mini',
      'gpt-5',
      'gpt-5.1',
    ])
  })

  it('accepts the dated snapshot', () => {
    expect(cheaperOpenaiModels('gpt-5.2-2025-12-11')).toEqual(cheaperOpenaiModels('gpt-5.2'))
  })

  it('leaves out models at the same price, and ones dearer on either side', () => {
    const cheaper = ids(cheaperOpenaiModels('gpt-5.1'))
    expect(cheaper).not.toContain('gpt-5')
    // GPT-6 Sol costs more per input token than GPT-5.1, though the same per output token.
    expect(cheaper).not.toContain('gpt-6-sol')
    expect(cheaper).toEqual(['gpt-5-nano', 'gpt-6-luna', 'gpt-5-mini'])
  })

  it.each(['gpt-5-nano', 'gpt-5.5', ''])('is empty and frozen for %j', (id) => {
    const cheaper = cheaperOpenaiModels(id)
    expect(cheaper).toEqual([])
    expect(Object.isFrozen(cheaper)).toBe(true)
  })
})
