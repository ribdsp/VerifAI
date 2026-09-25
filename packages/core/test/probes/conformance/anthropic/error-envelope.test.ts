import { describe, expect, it } from 'vitest'
import { errorEnvelope } from '../../../../src/probes/conformance/anthropic/error-envelope.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { exchange, inOrder, probeContext, sentJson } from '../../../fakes/context.js'
import {
  anthropicError,
  invalidRequest,
  jsonText,
  messageOk,
  openaiError,
  REQUEST_ID,
} from './edge.js'

const MESSAGE = 'messages: Input should be a valid list'

async function run(answer: Exchange) {
  const fake = probeContext(inOrder(answer))
  const signals = await errorEnvelope.run(fake.context)
  const [envelope, requestId] = signals
  return { signals, envelope, requestId, requests: fake.requests }
}

describe('conformance/anthropic/error-envelope', () => {
  it('sends a body that is not JSON, once, expecting a 400', async () => {
    const { signals, requests } = await run(invalidRequest(MESSAGE))

    expect(signals.map((entry) => entry.signalId)).toEqual(['envelope', 'request-id-header'])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: 'messages', provokes: [400] })
    expect(sentJson(requests[0])).toBeUndefined()
    expect(requests[0]?.tokens ?? 0).toBeLessThanOrEqual(errorEnvelope.cost.tokens)
  })

  it("reads Anthropic's envelope and a matching request-id header as the first-party API", async () => {
    const { envelope, requestId } = await run(
      invalidRequest(MESSAGE, { headers: [['request-id', REQUEST_ID]] }),
    )

    expect(envelope).toMatchObject({
      calibration: 'documented',
      family: 'protocol-conformance',
      llr: { translation: { direct: 0.3 }, platform: { 'first-party': 0.2 } },
    })
    expect(envelope?.observed).toBe(
      `A body that is not JSON was answered with a 400 invalid_request_error in Anthropic's error envelope, ${JSON.stringify(MESSAGE)}.`,
    )
    expect(requestId).toMatchObject({ llr: { platform: { 'first-party': 0.3 } } })
    expect(requestId?.observed).toContain('which begins with req_')
  })

  it("reads OpenAI's envelope as a layer that speaks OpenAI's API", async () => {
    const { envelope, requestId } = await run(openaiError(400, 'We could not parse the JSON body'))

    expect(envelope).toMatchObject({
      llr: { translation: { translated: 0.8, direct: -0.6 }, platform: { 'first-party': -0.3 } },
    })
    expect(requestId).toMatchObject({
      observed: 'The response had no request-id header.',
      llr: { platform: { 'first-party': -0.4 } },
    })
  })

  it.each([
    ['a page that is not JSON', exchange(400, '<html>Bad Request</html>')],
    ['a success', messageOk()],
  ])('reads %s as no envelope at all', async (_label, answered) => {
    const { envelope } = await run(answered)

    expect(envelope).toMatchObject({
      llr: { translation: { translated: 0.3, direct: -0.3 }, platform: { 'first-party': -0.4 } },
    })
  })

  it('lists what the envelope is missing or has changed', async () => {
    const { envelope, requestId } = await run(
      jsonText(400, '{"type":"error","error":{"type":7,"message":"m"}}', [
        ['request-id', 'abc123'],
      ]),
    )

    expect(envelope?.llr).toEqual({ platform: { 'first-party': -0.3 } })
    expect(envelope?.observed).toContain('error.type was')
    expect(envelope?.observed).toContain('; no request_id field.')
    expect(requestId).toMatchObject({ llr: {} })
    expect(requestId?.observed).toBe(
      'The request-id header is "abc123", which does not begin with req_; the body carries no request_id to compare it with.',
    )
  })

  it('reads a request-id header that differs from the body as a changed response', async () => {
    const { requestId } = await run(
      anthropicError(400, 'invalid_request_error', MESSAGE, {
        headers: [['request-id', 'req_somethingElse']],
      }),
    )

    expect(requestId).toMatchObject({ llr: { platform: { 'first-party': -0.3 } } })
    expect(requestId?.observed).toContain(`the body's request_id is ${JSON.stringify(REQUEST_ID)}`)
  })
})
