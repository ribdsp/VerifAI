import { openaiModel } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { reasoningMatrix } from '../../../../src/probes/conformance/openai/reasoning-matrix.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { OPENAI_INVALID_REQUEST_ERROR } from '../../../../src/sources/openai-conformance.js'
import type { Protocol } from '../../../../src/types/target.js'
import {
  inOrder,
  jsonExchange,
  probeContext,
  probeTarget,
  sentJson,
} from '../../../fakes/context.js'
import { anthropicError } from '../anthropic/edge.js'
import { openaiErrorExchange } from './edge.js'

const OK = jsonExchange(200, {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  // biome-ignore lint/style/useNamingConvention: the vendor's wire name.
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
})
const REFUSED = openaiErrorExchange(
  400,
  'Unsupported parameter: temperature is not supported with this model.',
)

async function run(
  model: string,
  answers: readonly Exchange[],
  protocol: Protocol = 'openai-chat',
) {
  const fake = probeContext(inOrder(...answers), { protocol, model })
  const signals = await reasoningMatrix.run(fake.context)
  return { signals, requests: fake.requests }
}

const target = (model: string) => probeTarget({ protocol: 'openai-chat', model })

describe('conformance/openai/reasoning-matrix', () => {
  it('applies to the models whose rules the docs settle, by ID or snapshot', () => {
    for (const model of ['gpt-5.2', 'gpt-5.2-2025-12-11', 'gpt-5', 'gpt-6-astra', 'gpt-6-sol']) {
      expect(reasoningMatrix.applies?.(target(model)), model).toBe(true)
    }
    for (const model of ['gpt-4o', 'gpt-5.2-pro', 'claude-opus-5-5']) {
      expect(reasoningMatrix.applies?.(target(model)), model).toBe(false)
    }
  })

  it('sends nothing for a model the docs do not list', async () => {
    const { signals, requests } = await run('gpt-4o', [OK])

    expect(signals).toEqual([])
    expect(requests).toHaveLength(0)
  })

  it('sends the control first, then each combination, within its budget', async () => {
    const { requests } = await run('gpt-5.2', [OK, OK, OK, REFUSED])

    expect(requests.map(sentJson)).toMatchObject([
      JSON.parse('{"reasoning_effort":"low","max_completion_tokens":16}'),
      JSON.parse('{"reasoning_effort":"none"}'),
      JSON.parse('{"reasoning_effort":"none","temperature":0.5}'),
      JSON.parse('{"reasoning_effort":"low","temperature":0.5}'),
    ])
    expect(sentJson(requests[0])).not.toHaveProperty('temperature')
    expect(sentJson(requests[1])).not.toHaveProperty('temperature')
    expect(requests).toHaveLength(reasoningMatrix.cost.requests)
    const tokens = requests.reduce((sum, request) => sum + (request.tokens ?? 0), 0)
    expect(tokens).toBeLessThanOrEqual(reasoningMatrix.cost.tokens)
    for (const request of requests) {
      expect(request.provokes).toEqual([400])
    }
  })

  it('sets the effort as Responses names it, at its minimum output', async () => {
    const { requests, signals } = await run('gpt-5.2', [OK, OK, OK, REFUSED], 'openai-responses')

    expect(requests.map(sentJson)).toMatchObject([
      // biome-ignore lint/style/useNamingConvention: the vendor's wire name.
      { reasoning: { effort: 'low' }, max_output_tokens: 16 },
      { reasoning: { effort: 'none' } },
      { reasoning: { effort: 'none' }, temperature: 0.5 },
      { reasoning: { effort: 'low' }, temperature: 0.5 },
    ])
    expect(signals[0]?.observed).toBe(
      'reasoning.effort: none was accepted; reasoning.effort: none, temperature: 0.5 was accepted; reasoning.effort: low, temperature: 0.5 was rejected.',
    )
  })

  it('reads GPT-5.2 answering as documented for the claim, and names the cheaper model that answers alike', async () => {
    const { signals } = await run('gpt-5.2', [OK, OK, OK, REFUSED])

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'documented-rejections',
      calibration: 'documented',
      family: 'protocol-conformance',
      expected:
        'For gpt-5.2, OpenAI documents: reasoning_effort: none accepted; reasoning_effort: none, temperature: 0.5 accepted; reasoning_effort: low, temperature: 0.5 rejected.',
      llr: { identity: { 'matches-claim': 0.3, 'same-vendor-cheaper': 0.3 } },
    })
    expect(signals[0]?.plainLanguage).toContain('gpt-5.1, so these answers do not tell them apart.')
  })

  it('reads an older GPT-5 model sold as GPT-5.2 against the claim and for the substitute', async () => {
    const { signals } = await run('gpt-5.2', [OK, REFUSED])

    expect(signals[0]?.llr).toEqual({
      identity: { 'matches-claim': -0.4, 'same-vendor-cheaper': 0.3 },
    })
    expect(signals[0]?.plainLanguage).toContain(
      'OpenAI documents the answers this endpoint gave for the cheaper gpt-5-nano, gpt-5-mini, gpt-5.',
    )
  })

  it('reads a layer that drops the fields as a layer, not against the claim', async () => {
    const { signals } = await run('gpt-5.2', [OK])

    expect(signals.map((entry) => entry.signalId)).toEqual([
      'documented-rejections',
      'accepted-where-documented-rejected',
    ])
    expect(signals[0]?.llr).toEqual({})
    expect(signals[1]?.llr).toEqual({ translation: { translated: 0.2 } })
  })

  it('keeps the older GPT-5 models open behind GPT-6 Astra, whose docs say nothing of effort none for them', async () => {
    const { signals, requests } = await run('gpt-6-astra', [OK, REFUSED])

    expect(requests).toHaveLength(2)
    expect(signals[0]?.llr).toEqual({ identity: { 'matches-claim': 0.3 } })
    expect(signals[0]?.plainLanguage).toContain('so this does not rule them out.')
  })

  it('stops at a refused control, citing where the claimed model lists the effort', async () => {
    const { signals, requests } = await run('gpt-5.2', [REFUSED])

    expect(requests).toHaveLength(1)
    expect(signals).toMatchObject([
      {
        signalId: 'control-rejected',
        expected:
          "reasoning_effort: low is accepted: OpenAI lists low among gpt-5.2's reasoning efforts.",
        citations: openaiModel('gpt-5.2')?.reasoningEfforts.sources,
      },
    ])
    expect(signals[0]?.llr.identity).toBeUndefined()
  })

  it('reads a control refused outside OpenAI’s envelope as a layer, citing the documented refusal', async () => {
    const { signals, requests } = await run('gpt-5.2', [
      anthropicError(
        400,
        'invalid_request_error',
        'reasoning_effort: Extra inputs are not permitted',
      ),
    ])

    expect(requests).toHaveLength(1)
    expect(signals).toMatchObject([
      { signalId: 'foreign-rejection', citations: [OPENAI_INVALID_REQUEST_ERROR] },
    ])
  })

  it('cites every documented fact it compares against', () => {
    const quotes = reasoningMatrix.citations.map(({ quote }) => quote)

    expect(quotes.some((quote) => quote.includes('will raise an error'))).toBe(true)
    expect(quotes.some((quote) => quote.includes('returns HTTP 400'))).toBe(true)
  })
})
