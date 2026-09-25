import { describe, expect, it } from 'vitest'
import { modelNotFound } from '../../../../src/probes/conformance/openai/model-not-found.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { exchange, inOrder, jsonExchange, probeContext, sentJson } from '../../../fakes/context.js'
import { openaiErrorExchange } from './edge.js'

const MODEL = 'gpt-verifai-n0nce7test-absent'
const MESSAGE = `The model \`${MODEL}\` does not exist or you do not have access to it.`

async function runWith(answer: Exchange) {
  const fake = probeContext(inOrder(answer), { protocol: 'openai-responses' })
  const signals = await modelNotFound.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/openai/model-not-found', () => {
  it("asks for a made-up model carrying the run's nonce, provoking the 404", async () => {
    const { requests } = await runWith(exchange(500))

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: 'responses', generates: true, provokes: [404] })
    expect(sentJson(requests[0])).toMatchObject({ model: MODEL })
    expect(requests[0]?.tokens).toBeLessThanOrEqual(modelNotFound.cost.tokens)
  })

  it("matches OpenAI's refusal field for field", async () => {
    const { signals } = await runWith(
      openaiErrorExchange(404, MESSAGE, { code: 'model_not_found' }),
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'refused-as-openai',
      calibration: 'heuristic',
      llr: { platform: { 'first-party': 0.3 }, translation: { direct: 0.2 } },
    })
  })

  it.each([
    ['a different param', 404, { param: 'model', code: 'model_not_found' }, MESSAGE],
    ['a different type', 404, { type: 'not_found_error', code: 'model_not_found' }, MESSAGE],
    ['no code', 404, {}, MESSAGE],
    ['other words', 404, { code: 'model_not_found' }, `Model ${MODEL} not found`],
    ['a 400', 400, { code: 'model_not_found' }, MESSAGE],
  ])('reads a refusal with %s as one of its own', async (_label, status, fields, message) => {
    const { signals } = await runWith(openaiErrorExchange(status, message, fields))

    expect(signals[0]).toMatchObject({
      signalId: 'refused-otherwise',
      llr: { platform: { 'first-party': -0.1 } },
    })
  })

  it('reads an answer as some other model having answered', async () => {
    const { signals } = await runWith(jsonExchange(200, { object: 'response' }))

    expect(signals[0]).toMatchObject({
      signalId: 'answered',
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.1 } },
    })
    expect(signals[0]?.observed).toContain(MODEL)
  })

  it('says nothing about a server error or a redirect', async () => {
    expect((await runWith(exchange(502))).signals).toEqual([])
    expect((await runWith(exchange(301))).signals).toEqual([])
  })
})
