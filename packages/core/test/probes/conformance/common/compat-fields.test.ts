import { describe, expect, it } from 'vitest'
import { compatFields } from '../../../../src/probes/conformance/common/compat-fields.js'
import type { Exchange } from '../../../../src/probes/types.js'
import {
  ANTHROPIC_COMPAT_FINGERPRINT_EMPTY,
  ANTHROPIC_COMPAT_LOGPROBS_EMPTY,
  ANTHROPIC_COMPAT_LOGPROBS_IGNORED,
} from '../../../../src/sources/anthropic-conformance-common.js'
import { exchange, inOrder, probeContext, sentJson } from '../../../fakes/context.js'
import { jsonText, openaiErrorExchange } from '../openai/edge.js'

function answer(fingerprint: string, logprobs: string): Exchange {
  return jsonText(
    200,
    `{"id":"chatcmpl-1","object":"chat.completion","system_fingerprint":${fingerprint},"choices":[{"index":0,"message":{"role":"assistant","content":"OK"},"logprobs":${logprobs}}]}`,
  )
}

async function runWith(reply: Exchange) {
  const fake = probeContext(inOrder(reply), { protocol: 'openai-chat', vendor: 'anthropic' })
  const signals = await compatFields.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/common/compat-fields', () => {
  it('asks Claude over Chat Completions for logprobs in one tiny generation', async () => {
    const { requests } = await runWith(exchange(500))

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: 'chat/completions', generates: true })
    expect(sentJson(requests[0])).toMatchObject({ logprobs: true, model: 'claude-opus-5-5' })
    expect(requests[0]?.tokens).toBeLessThanOrEqual(compatFields.cost.tokens)
  })

  it('reads a filled fingerprint and real log-probabilities', async () => {
    const { signals } = await runWith(
      answer(
        '"fp_1a2b"',
        '{"content":[{"token":"OK","logprob":-0.25},{"token":".","logprob":-1.5}]}',
      ),
    )

    expect(signals.map((found) => found.signalId)).toEqual([
      'fingerprint-present',
      'logprobs-present',
    ])
    expect(signals[0]).toMatchObject({
      calibration: 'documented',
      llr: { platform: { 'first-party': -0.6 } },
      citations: [ANTHROPIC_COMPAT_FINGERPRINT_EMPTY],
    })
    expect(signals[0]?.llr.identity).toBeUndefined()
    expect(signals[0]?.observed).toContain('"fp_1a2b"')
    expect(signals[1]).toMatchObject({
      llr: {
        identity: {
          'different-vendor': 0.6,
          'matches-claim': -0.6,
          'same-vendor-cheaper': -0.6,
        },
        platform: { 'first-party': -0.6 },
      },
      citations: [ANTHROPIC_COMPAT_LOGPROBS_EMPTY, ANTHROPIC_COMPAT_LOGPROBS_IGNORED],
    })
    expect(signals[1]?.observed).toContain('-0.25, -1.5')
    expect(signals[1]?.vetoes).toBeUndefined()
  })

  it.each([
    ['empty fields', '""', 'null'],
    ['no logprobs content', 'null', '{"content":[]}'],
    [
      'log-probabilities that are not real',
      'null',
      '{"content":[{"logprob":0},{"logprob":"-1"},{}]}',
    ],
    ['a logprobs value that is not an object', 'null', '[]'],
  ])(
    "says nothing about %s, as Anthropic's endpoint leaves them",
    async (_label, fingerprint, logprobs) => {
      expect((await runWith(answer(fingerprint, logprobs))).signals).toEqual([])
    },
  )

  it('says nothing about an answer without choices, or one that is not an object', async () => {
    expect((await runWith(jsonText(200, '{"system_fingerprint":""}'))).signals).toEqual([])
    expect((await runWith(jsonText(200, '[]'))).signals).toEqual([])
    expect((await runWith(exchange(200, 'OK'))).signals).toEqual([])
  })

  it('reads a refusal naming logprobs as not Anthropic refusing', async () => {
    const byParam = await runWith(openaiErrorExchange(400, 'Unsupported.', { param: 'logprobs' }))
    const byMessage = await runWith(
      jsonText(
        422,
        '{"type":"error","error":{"type":"invalid_request_error","message":"Logprobs are not supported"}}',
      ),
    )

    for (const { signals } of [byParam, byMessage]) {
      expect(signals).toHaveLength(1)
      expect(signals[0]).toMatchObject({
        signalId: 'logprobs-rejected',
        llr: { platform: { 'first-party': -0.3 } },
        citations: [ANTHROPIC_COMPAT_LOGPROBS_IGNORED],
      })
    }
    expect(byMessage.signals[0]?.observed).toContain('status 422: "Logprobs are not supported"')
  })

  it('says nothing about another refusal, a server error or a redirect', async () => {
    expect((await runWith(openaiErrorExchange(400, 'max_tokens: too small'))).signals).toEqual([])
    expect((await runWith(exchange(401, 'Unauthorized'))).signals).toEqual([])
    expect((await runWith(exchange(529))).signals).toEqual([])
    expect((await runWith(exchange(304))).signals).toEqual([])
  })
})
