import { ANTHROPIC_SAMPLING_COMPATIBILITY } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { samplingMatrix } from '../../../../src/probes/conformance/anthropic/sampling-matrix.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { inOrder, probeContext, probeTarget, sentJson } from '../../../fakes/context.js'
import { anthropicError, invalidRequest, messageOk, openaiError } from './edge.js'

const REFUSED = invalidRequest('temperature and top_p cannot both be specified for this model.')

async function run(model: string, ...answers: readonly Exchange[]) {
  const fake = probeContext(inOrder(...answers), { model })
  const signals = await samplingMatrix.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/anthropic/sampling-matrix', () => {
  it('applies to the models the docs settle', () => {
    expect(samplingMatrix.applies?.(probeTarget({ model: 'claude-opus-5-5' }))).toBe(true)
    expect(samplingMatrix.applies?.(probeTarget({ model: 'claude-opus-4-6' }))).toBe(true)
    expect(samplingMatrix.applies?.(probeTarget({ model: 'claude-mythos-5' }))).toBe(false)
    expect(samplingMatrix.applies?.(probeTarget({ model: 'claude-custom' }))).toBe(false)
  })

  it('sends nothing for a model the docs do not list', async () => {
    const { signals, requests } = await run('claude-custom', messageOk())

    expect(signals).toEqual([])
    expect(requests).toHaveLength(0)
  })

  it('sends the control first, then one cell per setting, within its budget', async () => {
    const { requests } = await run('claude-opus-5-5', messageOk(), REFUSED)

    expect(requests.map(sentJson)).toMatchObject([
      { temperature: 1 },
      { temperature: 0.5 },
      JSON.parse('{"top_p":0.5}'),
      JSON.parse('{"top_k":5}'),
    ])
    expect(requests).toHaveLength(samplingMatrix.cost.requests)
    const tokens = requests.reduce((sum, request) => sum + (request.tokens ?? 0), 0)
    expect(tokens).toBeLessThanOrEqual(samplingMatrix.cost.tokens)
    for (const request of requests) {
      expect(request.provokes).toEqual([400])
    }
  })

  it('reads documented refusals as the claim, and names the cheaper model that refuses alike', async () => {
    const { signals } = await run('claude-opus-5-5', messageOk(), REFUSED)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'documented-rejections',
      calibration: 'documented',
      observed: 'temperature: 0.5 was rejected; top_p: 0.5 was rejected; top_k: 5 was rejected.',
      llr: { identity: { 'matches-claim': 0.3, 'same-vendor-cheaper': 0.3 } },
    })
    expect(signals[0]?.plainLanguage).toContain('the cheaper claude-sonnet-5, so')
  })

  it('reads acceptance where the docs say refusal as a layer, for no model and against none', async () => {
    const { signals } = await run('claude-opus-5-5', messageOk())

    expect(signals.map((entry) => entry.signalId)).toEqual([
      'documented-rejections',
      'accepted-where-documented-rejected',
    ])
    expect(signals[0]?.llr).toEqual({})
    expect(signals[0]?.plainLanguage).toContain(
      'the cheaper claude-haiku-4-5-20251001, claude-sonnet-4-6.',
    )
    expect(signals[1]?.observed).toBe(
      'temperature: 0.5 was answered 200; top_p: 0.5 was answered 200; top_k: 5 was answered 200.',
    )
  })

  it('lets a refusal count for no model while an acceptance the docs rule out stands beside it', async () => {
    const { signals } = await run('claude-opus-5-5', messageOk(), REFUSED, messageOk())

    expect(signals[0]).toMatchObject({
      signalId: 'documented-rejections',
      observed: 'temperature: 0.5 was rejected; top_p: 0.5 was accepted; top_k: 5 was accepted.',
    })
    expect(signals[0]?.llr).toEqual({})
    expect(signals[0]?.plainLanguage).toContain(
      'so an acceptance the docs rule out does not count against the claim.',
    )
  })

  it('stops at a refused control, which every model accepts', async () => {
    const { signals, requests } = await run('claude-opus-5-5', REFUSED)

    expect(requests).toHaveLength(1)
    expect(signals).toMatchObject([
      {
        signalId: 'control-rejected',
        calibration: 'documented',
        llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
        citations: ANTHROPIC_SAMPLING_COMPATIBILITY.sources,
      },
    ])
    expect(signals[0]?.llr.identity).toBeUndefined()
  })

  it('reads a control refused outside the documented envelope as a layer', async () => {
    const { signals, requests } = await run('claude-opus-5-5', openaiError(400, 'bad temperature'))

    expect(requests).toHaveLength(1)
    expect(signals).toMatchObject([{ signalId: 'foreign-rejection' }])
  })

  it('says nothing when the control gets neither answer', async () => {
    const { signals, requests } = await run(
      'claude-opus-5-5',
      anthropicError(422, 'invalid_request_error', 'm'),
    )

    expect(requests).toHaveLength(1)
    expect(signals).toEqual([])
  })
})
