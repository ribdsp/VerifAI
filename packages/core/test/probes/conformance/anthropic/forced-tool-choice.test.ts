import { ANTHROPIC_REJECTIONS } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { forcedToolChoice } from '../../../../src/probes/conformance/anthropic/forced-tool-choice.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { inOrder, probeContext, probeTarget, sentJson } from '../../../fakes/context.js'
import { invalidRequest, messageOk } from './edge.js'

async function run(model: string, answer: Exchange) {
  const fake = probeContext(inOrder(answer), { model })
  const signals = await forcedToolChoice.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/anthropic/forced-tool-choice', () => {
  it('applies to the models the docs settle', () => {
    expect(forcedToolChoice.applies?.(probeTarget({ model: 'claude-opus-5-5' }))).toBe(true)
    expect(forcedToolChoice.applies?.(probeTarget({ model: 'claude-sonnet-5' }))).toBe(true)
    expect(forcedToolChoice.applies?.(probeTarget({ model: 'claude-haiku-4-5' }))).toBe(false)
  })

  it('forces use of one tool, budgeting for the tool prompt', async () => {
    const { requests } = await run('claude-opus-5-5', messageOk())

    expect(requests).toHaveLength(1)
    expect(sentJson(requests[0])).toMatchObject(
      JSON.parse('{"tool_choice":{"type":"any"},"tools":[{"name":"record_word"}]}'),
    )
    expect(requests[0]).toMatchObject({ provokes: [400], tokens: forcedToolChoice.cost.tokens })
  })

  it('reads the documented refusal, in the documented words, as the claim and the API', async () => {
    const { signals } = await run(
      'claude-opus-5-5',
      invalidRequest(ANTHROPIC_REJECTIONS.forcedToolChoice.value.message),
    )

    expect(signals).toMatchObject([
      {
        signalId: 'documented-rejections',
        llr: { identity: { 'matches-claim': 0.3 } },
      },
      {
        signalId: 'rejection-wording',
        calibration: 'documented',
        citations: ANTHROPIC_REJECTIONS.forcedToolChoice.sources,
      },
    ])
  })

  it('says nothing of identity when a model that takes forced tool use takes it, as any layer would', async () => {
    const { signals } = await run('claude-sonnet-5', messageOk())

    expect(signals).toHaveLength(1)
    expect(signals[0]?.llr).toEqual({})
  })

  it('sends nothing where the docs are silent', async () => {
    const { signals, requests } = await run('claude-haiku-4-5', messageOk())

    expect(signals).toEqual([])
    expect(requests).toHaveLength(0)
  })
})
