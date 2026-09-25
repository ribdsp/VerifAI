import { openaiEncodingFor } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { logitBias } from '../../../src/probes/causal/logit-bias.js'
import type { Exchange, ProbeRequest } from '../../../src/probes/types.js'
import { ProbeLost, ProbeNotApplicable } from '../../../src/runner/errors.js'
import { OPENAI_LOGIT_BIAS } from '../../../src/sources/openai.js'
import { type LocalEncoding, loadTokenizer } from '../../../src/tokenizer/local.js'
import { exchange, probeContext, probeTarget } from '../../fakes/context.js'
import { bodyOf, chat, withinCost } from './replies.js'

/** The one token ID a request biases. */
function biasedId(request: ProbeRequest): number {
  const bias = bodyOf(request).logit_bias as Record<string, number>
  const entries = Object.entries(bias)
  expect(entries).toHaveLength(1)
  expect(entries[0]?.[1]).toBe(100)
  return Number(entries[0]?.[0])
}

/** Answers with the biased token as `encoding` decodes it, passed through `shape`. */
function writes(encoding: LocalEncoding, shape: (word: string) => string = (word) => word) {
  return async (request: ProbeRequest): Promise<Exchange> => {
    const tokenizer = await loadTokenizer(encoding)
    return chat(shape(tokenizer.decode([biasedId(request)]).trim()))
  }
}

async function runWith(
  answer: (request: ProbeRequest) => Exchange | Promise<Exchange>,
  model = 'gpt-4o',
) {
  const fake = probeContext(answer, { protocol: 'openai-chat', model })
  const signals = await logitBias.run(fake.context)
  expect(fake.requests).toHaveLength(1)
  expect(withinCost(logitBias, fake)).toBe(true)
  return { fake, signals }
}

describe('causal/logit-bias', () => {
  it("finds the biased token written as the claimed encoding's word", async () => {
    const { fake, signals } = await runWith(writes('o200k_base'))

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      probeId: 'causal/logit-bias',
      signalId: 'claimed-token',
      calibration: openaiEncodingFor('gpt-4o')?.calibration,
      llr: { identity: { 'matches-claim': 0.2, 'different-vendor': -0.7 } },
    })
    expect(signals[0]?.citations[0]).toBe(OPENAI_LOGIT_BIAS)
    const request = fake.requests[0]
    expect(bodyOf(request).max_completion_tokens).toBe(2)
    const id = request ? biasedId(request) : 0
    expect(id).toBeGreaterThanOrEqual(1000)
    expect(id).toBeLessThan(8000)
  })

  it('reads the word written twice, with spacing, as the same token', async () => {
    const { signals } = await runWith(writes('o200k_base', (word) => ` ${word}${word}\n`))

    expect(signals[0]?.signalId).toBe('claimed-token')
  })

  it("finds the other encoding's word as a model on another vocabulary", async () => {
    const { signals } = await runWith(writes('cl100k_base'))

    expect(signals[0]).toMatchObject({
      signalId: 'other-encoding-token',
      llr: { identity: { 'matches-claim': -0.7, 'same-vendor-cheaper': 0.3 } },
    })
  })

  it('reads the claimed encoding from the claimed model', async () => {
    const { signals } = await runWith(writes('cl100k_base'), 'gpt-4-turbo')

    expect(signals[0]?.signalId).toBe('claimed-token')
  })

  it('reads a word from neither encoding as the bias not followed', async () => {
    const { signals } = await runWith(() => chat('zzqx'))

    expect(signals[0]).toMatchObject({
      signalId: 'bias-not-followed',
      llr: { translation: { translated: 0.4 } },
    })
    expect(signals[0]?.llr.identity).toBeUndefined()
  })

  it.each([
    ['an empty answer', chat(' ')],
    ['a failed request', exchange(500, 'upstream failed')],
  ])('judges nothing from %s', async (_label, answer) => {
    const { signals } = await runWith(() => answer)

    expect(signals).toEqual([])
  })

  it('picks the same token for the same nonce', async () => {
    const first = await runWith(() => chat('zzqx'))
    const second = await runWith(() => chat('zzqx'))

    const [a] = first.fake.requests
    const [b] = second.fake.requests
    expect(a && biasedId(a)).toBe(b && biasedId(b))
  })

  it('lets runner errors through', async () => {
    const fake = probeContext(() => new ProbeLost(), { protocol: 'openai-chat', model: 'gpt-4o' })

    await expect(logitBias.run(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })

  it('is not applicable without a local encoding for the claimed model', async () => {
    const fake = probeContext(() => chat('x'), { protocol: 'openai-chat', model: 'not-a-model' })

    await expect(logitBias.run(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
  })

  it.each([
    ['gpt-4o', true],
    ['gpt-4o-mini', true],
    ['gpt-4.1', true],
    ['gpt-4-turbo', true],
    ['gpt-5', false],
    ['o3', false],
    ['gpt-4o-audio-preview', false],
  ])('applies to %s: %s', (model, expected) => {
    expect(logitBias.applies?.(probeTarget({ protocol: 'openai-chat', model }))).toBe(expected)
  })
})
