import { ANTHROPIC_REJECTIONS } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { assistantPrefill } from '../../../../src/probes/conformance/anthropic/assistant-prefill.js'
import { PROMPT } from '../../../../src/probes/conformance/anthropic/shared.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { inOrder, probeContext, probeTarget, sentJson } from '../../../fakes/context.js'
import { invalidRequest, messageOk } from './edge.js'

const DOCUMENTED = invalidRequest(ANTHROPIC_REJECTIONS.prefill.value.message)

async function run(model: string, answer: Exchange) {
  const fake = probeContext(inOrder(answer), { model })
  const signals = await assistantPrefill.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/anthropic/assistant-prefill', () => {
  it('applies to the models the docs settle', () => {
    expect(assistantPrefill.applies?.(probeTarget({ model: 'claude-opus-5-5' }))).toBe(true)
    expect(assistantPrefill.applies?.(probeTarget({ model: 'claude-haiku-4-5' }))).toBe(true)
    expect(assistantPrefill.applies?.(probeTarget({ model: 'claude-custom' }))).toBe(false)
  })

  it('sends a conversation that ends in an assistant turn, within its budget', async () => {
    const { requests } = await run('claude-opus-5-5', DOCUMENTED)

    expect(requests).toHaveLength(1)
    expect(sentJson(requests[0])).toMatchObject({
      messages: [
        { role: 'user', content: PROMPT },
        { role: 'assistant', content: 'o' },
      ],
    })
    expect(requests[0]).toMatchObject({ provokes: [400] })
    expect(requests[0]?.tokens).toBeLessThanOrEqual(assistantPrefill.cost.tokens)
  })

  it('reads the documented refusal, in the documented words, as the claim and the API', async () => {
    const { signals } = await run('claude-opus-5-5', DOCUMENTED)

    expect(signals).toMatchObject([
      {
        signalId: 'documented-rejections',
        observed: 'an assistant prefill ("o") was rejected.',
        llr: { identity: { 'matches-claim': 0.3 } },
      },
      {
        signalId: 'rejection-wording',
        calibration: 'documented',
        citations: ANTHROPIC_REJECTIONS.prefill.sources,
      },
    ])
  })

  it('reads a refusal in other words as a layer', async () => {
    const { signals } = await run('claude-opus-5-5', invalidRequest('Prefill is not supported.'))

    expect(signals[1]).toMatchObject({ signalId: 'rejection-wording', calibration: 'heuristic' })
  })

  it('says nothing of identity when a model that takes prefills takes one, as any layer would', async () => {
    const { signals } = await run('claude-haiku-4-5', messageOk())

    expect(signals).toMatchObject([
      {
        signalId: 'documented-rejections',
        expected:
          'For claude-haiku-4-5-20251001, Anthropic documents: an assistant prefill ("o") accepted.',
        llr: {},
      },
    ])
    expect(signals[0]?.llr).toEqual({})
  })
})
