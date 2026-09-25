import { describe, expect, it } from 'vitest'
import { unknownParameter } from '../../../../src/probes/conformance/openai/unknown-parameter.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { exchange, inOrder, jsonExchange, probeContext, sentJson } from '../../../fakes/context.js'
import { jsonText, openaiErrorExchange } from './edge.js'

const NAME = 'verifai_n0nce7test'

async function runWith(answer: Exchange) {
  const fake = probeContext(inOrder(answer), { protocol: 'openai-chat' })
  const signals = await unknownParameter.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/openai/unknown-parameter', () => {
  it("sends one tiny generation carrying a parameter named after the run's nonce", async () => {
    const { requests } = await runWith(exchange(500))

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: 'chat/completions', generates: true })
    expect(sentJson(requests[0])).toMatchObject({ [NAME]: true, model: 'gpt-5' })
    expect(requests[0]?.tokens).toBeLessThanOrEqual(unknownParameter.cost.tokens)
  })

  it("matches OpenAI's current rejection", async () => {
    const { signals } = await runWith(
      openaiErrorExchange(400, `Unknown parameter: '${NAME}'.`, {
        param: NAME,
        code: 'unknown_parameter',
      }),
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'rejected-as-openai',
      calibration: 'heuristic',
      llr: { platform: { 'first-party': 0.3 }, translation: { direct: 0.2 } },
    })
  })

  it("matches the older routes' wording", async () => {
    const { signals } = await runWith(
      openaiErrorExchange(400, `Unrecognized request argument supplied: ${NAME}`),
    )

    expect(signals[0]?.signalId).toBe('rejected-as-openai')
  })

  it('reads the right words with the wrong code, or another envelope, as a rejection of its own', async () => {
    const wrongCode = await runWith(
      openaiErrorExchange(400, `Unknown parameter: '${NAME}'.`, { code: 'invalid_value' }),
    )
    const anthropic = await runWith(
      jsonText(400, '{"type":"error","error":{"type":"invalid_request_error","message":"m"}}'),
    )
    const unprocessable = await runWith(
      openaiErrorExchange(422, `Unknown parameter: '${NAME}'.`, { code: 'unknown_parameter' }),
    )

    for (const { signals } of [wrongCode, anthropic, unprocessable]) {
      expect(signals[0]).toMatchObject({
        signalId: 'rejected-otherwise',
        llr: { platform: { 'first-party': -0.1 } },
      })
    }
  })

  it('reads an answer as the parameter having been dropped', async () => {
    const { signals } = await runWith(jsonExchange(200, { id: 'x' }))

    expect(signals[0]).toMatchObject({
      signalId: 'accepted',
      llr: { platform: { 'first-party': -0.2 }, translation: { translated: 0.2 } },
    })
    expect(signals[0]?.observed).toContain(NAME)
  })

  it('says nothing about a server error or a redirect', async () => {
    expect((await runWith(exchange(503))).signals).toEqual([])
    expect((await runWith(exchange(307))).signals).toEqual([])
  })
})
