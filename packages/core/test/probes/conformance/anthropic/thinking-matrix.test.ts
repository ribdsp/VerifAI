import { ANTHROPIC_REJECTIONS } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { thinkingMatrix } from '../../../../src/probes/conformance/anthropic/thinking-matrix.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { probeContext, probeTarget, sentJson } from '../../../fakes/context.js'
import { byBody, invalidRequest, messageOk } from './edge.js'

type Mode = 'enabled' | 'adaptive' | 'disabled'
type Answers = Readonly<Record<Mode, Exchange>>

const modeOf = (body: Record<string, unknown>): Mode =>
  (body.thinking as { readonly type: Mode }).type

async function run(model: string, answers: Answers) {
  const fake = probeContext(
    byBody((body) => answers[modeOf(body)]),
    { model },
  )
  const signals = await thinkingMatrix.run(fake.context)
  return { signals, requests: fake.requests }
}

/** Claude Opus 5.5 as Anthropic documents it: thinking always on. */
const ALWAYS_ON: Answers = {
  enabled: invalidRequest(ANTHROPIC_REJECTIONS.thinkingEnabled.value.message),
  adaptive: messageOk(),
  disabled: invalidRequest(ANTHROPIC_REJECTIONS.thinkingDisabled.value.message),
}

describe('conformance/anthropic/thinking-matrix', () => {
  it('applies to the models the docs settle', () => {
    expect(thinkingMatrix.applies?.(probeTarget({ model: 'claude-opus-5-5' }))).toBe(true)
    expect(thinkingMatrix.applies?.(probeTarget({ model: 'claude-custom' }))).toBe(false)
  })

  it('sends each mode the docs settle, with room for a thinking model to answer', async () => {
    const { requests } = await run('claude-opus-5-5', ALWAYS_ON)

    expect(requests.map(sentJson)).toMatchObject([
      JSON.parse('{"thinking":{"type":"enabled","budget_tokens":1024},"max_tokens":1025}'),
      JSON.parse('{"thinking":{"type":"adaptive"},"max_tokens":1025}'),
      JSON.parse('{"thinking":{"type":"disabled"},"max_tokens":1}'),
    ])
    const tokens = requests.reduce((sum, request) => sum + (request.tokens ?? 0), 0)
    expect(tokens).toBeLessThanOrEqual(thinkingMatrix.cost.tokens)
  })

  it('reads the documented refusals as the claim, which no cheaper model shares', async () => {
    const { signals } = await run('claude-opus-5-5', ALWAYS_ON)

    expect(signals).toMatchObject([
      {
        signalId: 'documented-rejections',
        observed:
          'thinking enabled with a 1024-token budget was rejected; adaptive thinking was accepted; thinking disabled was rejected.',
        llr: { identity: { 'matches-claim': 0.3, 'same-vendor-cheaper': -0.4 } },
      },
      { signalId: 'rejection-wording', calibration: 'documented' },
    ])
  })

  it('sends only the modes the docs settle for the claimed model', async () => {
    const { signals, requests } = await run('claude-haiku-4-5', {
      enabled: messageOk(),
      adaptive: invalidRequest(ANTHROPIC_REJECTIONS.thinkingAdaptive.value.message),
      disabled: messageOk(),
    })

    expect(requests.map((request) => modeOf(sentJson(request) as Record<string, unknown>))).toEqual(
      ['enabled', 'adaptive'],
    )
    expect(signals[0]).toMatchObject({ llr: { identity: { 'matches-claim': 0.3 } } })
  })

  it("takes either documented wording for a refused 'disabled'", async () => {
    const { signals } = await run('claude-mythos-preview', {
      enabled: messageOk(),
      adaptive: messageOk(),
      disabled: invalidRequest(ANTHROPIC_REJECTIONS.thinkingDisabledMythosPreview.value.message),
    })

    expect(signals[1]).toMatchObject({ signalId: 'rejection-wording', calibration: 'documented' })
  })

  it('reads Haiku 4.5 behind a layer that answers adaptive thinking as the layer, not against the claim', async () => {
    const { signals } = await run('claude-haiku-4-5', {
      enabled: messageOk(),
      adaptive: messageOk(),
      disabled: messageOk(),
    })

    expect(signals).toMatchObject([
      {
        signalId: 'documented-rejections',
        observed:
          'thinking enabled with a 1024-token budget was accepted; adaptive thinking was accepted.',
      },
      {
        signalId: 'accepted-where-documented-rejected',
        observed: 'adaptive thinking was answered 200.',
        llr: { translation: { translated: 0.2 } },
      },
    ])
    expect(signals[0]?.llr).toEqual({})
  })
})
