import { describe, expect, it } from 'vitest'
import { ANTHROPIC_COUNT_TOKENS_PATH } from '../../../src/adapters/anthropic-messages.js'
import { countTokensAgreement } from '../../../src/probes/accounting/count-tokens-agreement.js'
import { baselinePrompt } from '../../../src/probes/accounting/shared.js'
import { usageArithmetic } from '../../../src/probes/accounting/usage-arithmetic.js'
import type { Exchange } from '../../../src/probes/types.js'
import { ProbeLost } from '../../../src/runner/errors.js'
import {
  ANTHROPIC_COUNT_SAME_INPUTS,
  ANTHROPIC_COUNT_TOTAL,
  ANTHROPIC_TOKENIZER_STEP_RANGE,
} from '../../../src/sources/anthropic-tokenizer.js'
import { MEASURED_COUNT_STEP } from '../../../src/sources/measured-accounting.js'
import { exchange, jsonExchange, type ProbeAnswer, probeContext } from '../../fakes/context.js'
import { OMIT, reply, usageWith } from './replies.js'

// biome-ignore lint/style/useNamingConvention: Anthropic's wire name.
const counted = (tokens: number) => jsonExchange(200, { input_tokens: tokens })

/** The baseline answered with `usage`, and the counting endpoint with `count`. */
function endpoint(usage: string | typeof OMIT, count: Exchange): ProbeAnswer {
  return (request) =>
    request.path === ANTHROPIC_COUNT_TOKENS_PATH ? count : reply('anthropic-messages', { usage })
}

async function runWith(model: string, used: number, count: Exchange) {
  const fake = probeContext(endpoint(usageWith('anthropic-messages', used), count), { model })
  const signals = await countTokensAgreement.run(fake.context)
  expect(signals).toHaveLength(1)
  return { found: signals[0], requests: fake.requests }
}

describe('accounting/count-tokens-agreement', () => {
  it("counts the baseline's own messages under the claimed model", async () => {
    const { found, requests } = await runWith('claude-opus-5-5', 312, counted(318))

    expect(found).toMatchObject({
      signalId: 'agree',
      family: 'accounting',
      calibration: 'documented',
      llr: {},
    })
    expect(found?.citations).toContain(MEASURED_COUNT_STEP)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      path: ANTHROPIC_COUNT_TOKENS_PATH,
      method: 'POST',
      protocol: 'anthropic-messages',
      generates: false,
      tokens: 0,
      provokes: [401, 403, 404, 405],
      body: {
        json: {
          model: 'claude-opus-5-5',
          messages: [{ role: 'user', content: baselinePrompt('n0nce7test') }],
        },
      },
    })
  })

  it("sends the gateway's own model name in both requests", async () => {
    const fake = probeContext(endpoint(usageWith('anthropic-messages', 312), counted(318)), {
      model: 'claude-opus-4-6',
      requestedModel: 'reseller/claude-opus-4.6',
    })
    await countTokensAgreement.run(fake.context)

    expect(fake.requests.map((request) => request.body)).toMatchObject([
      { json: { model: 'reseller/claude-opus-4.6' } },
      { json: { model: 'reseller/claude-opus-4.6' } },
    ])
  })

  it('adds cache reads to the input the answer reported', async () => {
    const usage = '{"input_tokens":4,"cache_read_input_tokens":300,"output_tokens":1}'
    const fake = probeContext(endpoint(usage, counted(306)))

    const [found] = await countTokensAgreement.run(fake.context)

    expect(found?.signalId).toBe('agree')
  })

  it.each([
    ['a missing endpoint', exchange(404, 'Not Found'), 'status 404'],
    ['a count without input_tokens', jsonExchange(200, { tokens: 318 }), 'status 200'],
    ['a count that is not JSON', exchange(200, 'ok'), 'status 200'],
  ])('points away from the first-party API on %s', async (_label, answer, status) => {
    const { found } = await runWith('claude-opus-5-5', 312, answer)

    expect(found).toMatchObject({
      signalId: 'no-count',
      calibration: 'documented',
      llr: { platform: { 'first-party': -0.4 }, translation: { translated: 0.2 } },
      citations: [ANTHROPIC_COUNT_TOTAL, ANTHROPIC_COUNT_SAME_INPUTS],
    })
    expect(found?.observed).toContain(status)
  })

  it('reads a count one step above the usage as the older tokenizer answering', async () => {
    const { found } = await runWith('claude-opus-5-5', 300, counted(390))

    expect(found).toMatchObject({
      signalId: 'older-tokenizer',
      family: 'tokenizer',
      calibration: 'documented',
      llr: {
        identity: { 'matches-claim': -0.3, 'same-vendor-cheaper': 0.4 },
        translation: { translated: 0.2 },
      },
    })
    expect(found?.citations).toContain(ANTHROPIC_TOKENIZER_STEP_RANGE)
    expect(found?.plainLanguage).toContain('gave 390 tokens; the answer reported 300')
  })

  it('reads usage one step above the count as the newer tokenizer answering', async () => {
    const { found } = await runWith('claude-sonnet-4-6', 390, counted(300))

    expect(found).toMatchObject({
      signalId: 'newer-tokenizer',
      llr: { identity: { 'matches-claim': -0.3, 'same-vendor-cheaper': 0.3 } },
    })
  })

  it('names no cheaper model when none uses the other tokenizer', async () => {
    const { found } = await runWith('claude-haiku-4-5', 390, counted(300))

    expect(found?.signalId).toBe('newer-tokenizer')
    expect(found?.llr.identity).toEqual({ 'matches-claim': -0.3 })
  })

  it.each([
    ['a gap in the wrong direction for the claim', 'claude-opus-5-5', 390, 300],
    ['a gap wider than the step', 'claude-opus-5-5', 300, 600],
    ['a gap for a model without a known tokenizer', 'claude-house-1', 300, 390],
    ['a ratio of two on a short prompt', 'claude-sonnet-4-6', 40, 20],
  ])("reads %s as a count that is not Anthropic's", async (_label, model, used, count) => {
    const { found } = await runWith(model, used, counted(count))

    expect(found).toMatchObject({
      signalId: 'disagree',
      calibration: 'heuristic',
      llr: { translation: { translated: 0.3 } },
    })
  })

  it('does not count when the answer reported no input', async () => {
    const fake = probeContext(endpoint(OMIT, counted(300)))

    await expect(countTokensAgreement.run(fake.context)).resolves.toEqual([])
    expect(fake.requests).toHaveLength(1)
  })

  it('reads the same baseline as the other accounting probes', async () => {
    const fake = probeContext(endpoint(usageWith('anthropic-messages', 312), counted(312)))

    await usageArithmetic.run(fake.context)
    await countTokensAgreement.run(fake.context)

    expect(fake.requests.map((request) => request.generates)).toEqual([true, false])
  })

  it('is lost when the baseline is not answered', async () => {
    const fake = probeContext(() => exchange(529, 'overloaded'))

    await expect(countTokensAgreement.run(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })
})
