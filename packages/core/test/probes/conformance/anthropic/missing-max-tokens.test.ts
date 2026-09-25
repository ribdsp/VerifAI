import { describe, expect, it } from 'vitest'
import { missingMaxTokens } from '../../../../src/probes/conformance/anthropic/missing-max-tokens.js'
import { PROMPT } from '../../../../src/probes/conformance/anthropic/shared.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { inOrder, probeContext, sentJson } from '../../../fakes/context.js'
import { anthropicError, invalidRequest, messageOk, openaiError } from './edge.js'

async function run(answer: Exchange) {
  const fake = probeContext(inOrder(answer))
  const signals = await missingMaxTokens.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/anthropic/missing-max-tokens', () => {
  it('sends a generation without max_tokens, budgeted for a default it cannot see', async () => {
    const { requests } = await run(messageOk())

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      path: 'messages',
      protocol: 'anthropic-messages',
      generates: true,
      provokes: [400],
      tokens: missingMaxTokens.cost.tokens,
    })
    expect(sentJson(requests[0])).toEqual({
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: PROMPT }],
    })
  })

  it('names the model the way the gateway sells it', async () => {
    const fake = probeContext(inOrder(messageOk()), {
      model: 'claude-opus-4-6',
      requestedModel: 'reseller/claude-opus-4.6',
    })
    await missingMaxTokens.run(fake.context)

    expect(sentJson(fake.requests[0])).toMatchObject({ model: 'reseller/claude-opus-4.6' })
  })

  it('reads an answer as a layer that filled the setting in', async () => {
    const { signals } = await run(messageOk())

    expect(signals).toMatchObject([
      {
        signalId: 'accepted',
        calibration: 'documented',
        llr: { platform: { 'first-party': -0.4 }, translation: { translated: 0.3 } },
      },
    ])
  })

  it("reads a refusal in Anthropic's envelope as the API itself", async () => {
    const { signals } = await run(invalidRequest('max_tokens: Field required'))

    expect(signals).toMatchObject([
      {
        signalId: 'refused',
        llr: { translation: { direct: 0.2 }, platform: { 'first-party': 0.1 } },
      },
    ])
  })

  it.each([
    ["a refusal in OpenAI's envelope", openaiError(400, 'max_tokens is required')],
    ['another status', anthropicError(422, 'invalid_request_error', 'm')],
  ])('says nothing of %s', async (_label, answered) => {
    const { signals } = await run(answered)

    expect(signals).toEqual([])
  })
})
