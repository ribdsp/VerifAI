import { describe, expect, it } from 'vitest'
import { authOnlyHeaders } from '../../../../src/probes/conformance/openai/auth-only-headers.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { exchange, inOrder, probeContext } from '../../../fakes/context.js'
import { edge401 } from './edge.js'

const REQUEST_ID = `req_${'0123456789abcdef'.repeat(2)}`

async function runWith(answer: Exchange) {
  const fake = probeContext(inOrder(answer), { protocol: 'openai-chat' })
  const signals = await authOnlyHeaders.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/openai/auth-only-headers', () => {
  it("matches a request id in OpenAI's format with no authenticated-only header", async () => {
    const { signals, requests } = await runWith(
      edge401('get-models', [['x-request-id', REQUEST_ID]]),
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'request-id-match',
      llr: { platform: { 'first-party': 0.2 } },
    })
    expect(requests).toEqual([
      { path: 'models', method: 'GET', credential: 'none', provokes: [401] },
    ])
  })

  it('reads a request id in another format as a mismatch', async () => {
    const { signals } = await runWith(
      edge401('get-models', [['x-request-id', '6f1d2c3b-0000-4000-8000-000000000000']]),
    )

    expect(signals[0]).toMatchObject({
      signalId: 'request-id-mismatch',
      llr: { platform: { 'first-party': -0.1 } },
    })
  })

  it('names the headers OpenAI sends only after accepting a key', async () => {
    const { signals } = await runWith(
      edge401('get-models', [
        ['x-request-id', REQUEST_ID],
        ['openai-processing-ms', '12'],
        ['openai-version', '2020-10-01'],
      ]),
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'authenticated-headers-present',
      llr: { platform: { 'first-party': -0.3 } },
    })
    expect(signals[0]?.observed).toContain('openai-processing-ms, openai-version')
  })

  it('says nothing when the request id is hidden or missing', async () => {
    const { signals } = await runWith(edge401('get-models'))

    expect(signals).toEqual([])
  })

  it('says nothing about a response that is not a 401', async () => {
    const { signals } = await runWith(exchange(200, '{}', [['openai-version', '2020-10-01']]))

    expect(signals).toEqual([])
  })
})
