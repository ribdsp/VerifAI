import { describe, expect, it } from 'vitest'
import { betaHeader } from '../../../../src/probes/conformance/anthropic/beta-header.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { exchange, inOrder, probeContext } from '../../../fakes/context.js'
import { invalidRequest, messageOk, openaiError } from './edge.js'

const NAME = 'verifai-probe-n0nce7test-2026-09-24'
const DOCUMENTED = `Unexpected value(s) \`${NAME}\` for the \`anthropic-beta\` header. Please consult our documentation at platform.claude.com/docs or try again without the header.`

async function run(answer: Exchange) {
  const fake = probeContext(inOrder(answer))
  const signals = await betaHeader.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/anthropic/beta-header', () => {
  it("sends a beta name carrying the run's nonce, expecting a 400", async () => {
    const { requests } = await run(messageOk())

    expect(requests).toHaveLength(1)
    expect(requests[0]?.headers).toContainEqual(['anthropic-beta', NAME])
    expect(requests[0]).toMatchObject({ path: 'messages', provokes: [400] })
    expect(requests[0]?.tokens).toBeLessThanOrEqual(betaHeader.cost.tokens)
  })

  it('reads an answer as a layer that dropped the header', async () => {
    const { signals } = await run(messageOk())

    expect(signals).toMatchObject([
      {
        signalId: 'accepted',
        calibration: 'documented',
        llr: { translation: { translated: 0.3, direct: -0.3 }, platform: { 'first-party': -0.4 } },
      },
    ])
  })

  it('reads the documented refusal, naming the beta back, as the API itself', async () => {
    const { signals } = await run(invalidRequest(DOCUMENTED))

    expect(signals).toMatchObject([
      {
        signalId: 'refused-as-anthropic',
        llr: { translation: { direct: 0.4 }, platform: { 'first-party': 0.3 } },
      },
    ])
    expect(signals[0]?.expected).toContain(DOCUMENTED)
  })

  it.each([
    ["OpenAI's envelope", openaiError(400, DOCUMENTED)],
    ['other words', invalidRequest('Unknown beta')],
  ])('reads a refusal in %s as a layer', async (_label, answered) => {
    const { signals } = await run(answered)

    expect(signals).toMatchObject([
      {
        signalId: 'refused-otherwise',
        llr: { translation: { translated: 0.2 }, platform: { 'first-party': -0.2 } },
      },
    ])
  })

  it('reads another status as neither', async () => {
    const { signals } = await run(exchange(404))

    expect(signals).toMatchObject([{ signalId: 'other-status', llr: {} }])
  })
})
