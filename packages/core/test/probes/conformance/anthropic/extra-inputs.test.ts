import { describe, expect, it } from 'vitest'
import { extraInputs } from '../../../../src/probes/conformance/anthropic/extra-inputs.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { exchange, inOrder, probeContext, sentJson } from '../../../fakes/context.js'
import { anthropicError, invalidRequest, messageOk, openaiError } from './edge.js'

async function run(answer: Exchange) {
  const fake = probeContext(inOrder(answer))
  const signals = await extraInputs.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/anthropic/extra-inputs', () => {
  it('sends one token of the prompt with seed set, expecting a 400', async () => {
    const { requests } = await run(messageOk())

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: 'messages', provokes: [400], generates: true })
    expect(sentJson(requests[0])).toMatchObject(JSON.parse('{"seed":7,"max_tokens":1}'))
    expect(requests[0]?.tokens).toBeLessThanOrEqual(extraInputs.cost.tokens)
  })

  it('reads an answer as a layer that passed the field on or dropped it', async () => {
    const { signals } = await run(messageOk())

    expect(signals).toMatchObject([
      {
        signalId: 'accepted',
        calibration: 'heuristic',
        family: 'protocol-conformance',
        llr: { translation: { translated: 0.3 }, platform: { 'first-party': -0.3 } },
      },
    ])
  })

  it("reads a refusal in the validator's words as the API itself", async () => {
    const { signals } = await run(invalidRequest('seed: Extra inputs are not permitted'))

    expect(signals).toMatchObject([
      {
        signalId: 'refused-as-anthropic',
        llr: { translation: { direct: 0.2 }, platform: { 'first-party': 0.1 } },
      },
    ])
  })

  it.each([
    ["OpenAI's words", openaiError(400, 'Unrecognized request argument supplied: seed')],
    ["Anthropic's envelope with other words", invalidRequest('seed is not allowed')],
    [
      'another 4XX',
      anthropicError(422, 'invalid_request_error', 'seed: Extra inputs are not permitted'),
    ],
  ])('reads a refusal in %s as a layer', async (_label, answered) => {
    const { signals } = await run(answered)

    expect(signals).toMatchObject([
      { signalId: 'refused-otherwise', llr: { translation: { translated: 0.2 } } },
    ])
  })

  it.each([
    ['a redirect', exchange(302)],
    ['a server error', anthropicError(500, 'api_error', 'm')],
  ])('says nothing of %s', async (_label, answered) => {
    const { signals } = await run(answered)

    expect(signals).toEqual([])
  })
})
