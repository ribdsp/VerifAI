import { describe, expect, it } from 'vitest'
import { empty404 } from '../../../../src/probes/conformance/openai/empty-404.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { exchange, probeContext } from '../../../fakes/context.js'
import { byRoute, openaiErrorExchange, UNROUTED_KEY } from './edge.js'

const WRONG_METHOD_KEY = 'POST models'

async function runWith(answers: Readonly<Record<string, Exchange>>) {
  const fake = probeContext(byRoute(answers), { protocol: 'openai-chat' })
  const signals = await empty404.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/openai/empty-404', () => {
  it('matches when both requests get an empty 404', async () => {
    const { signals, requests } = await runWith({})

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'match',
      llr: { platform: { 'first-party': 0.2 }, translation: { direct: 0.2 } },
    })
    expect(signals[0]?.observed).toContain('POST models answered 404 with an empty body')
    expect(requests[0]).toEqual({
      path: 'models',
      method: 'POST',
      credential: 'none',
      provokes: [404],
    })
    expect(requests[1]?.path).toBe('nonexistent-n0nce7test')
  })

  it('calls one empty 404 of two a partial match', async () => {
    const { signals } = await runWith({
      [WRONG_METHOD_KEY]: openaiErrorExchange(404, 'Not found'),
    })

    expect(signals[0]).toMatchObject({
      signalId: 'partial-match',
      llr: { platform: { 'first-party': 0.1 } },
    })
    expect(signals[0]?.observed).toMatch(/POST models answered 404 with a \d+-byte body/)
  })

  it('reports a mismatch when neither is an empty 404', async () => {
    const { signals } = await runWith({
      [WRONG_METHOD_KEY]: exchange(405),
      [UNROUTED_KEY]: exchange(404, 'Not Found'),
    })

    expect(signals[0]).toMatchObject({
      signalId: 'mismatch',
      llr: { platform: { 'first-party': -0.1 } },
    })
  })
})
