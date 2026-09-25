import { describe, expect, it } from 'vitest'
import { proxyWasmHeader } from '../../../../src/probes/conformance/openai/proxy-wasm-header.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { exchange, probeContext } from '../../../fakes/context.js'
import { byRoute, edge401, ROUTE_KEYS, UNROUTED_KEY } from './edge.js'

const WASM: readonly [string, string] = ['x-openai-proxy-wasm', 'v0.1']

async function runWith(answers: Readonly<Record<string, Exchange>>) {
  const fake = probeContext(byRoute(answers), { protocol: 'openai-responses' })
  const signals = await proxyWasmHeader.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/openai/proxy-wasm-header', () => {
  it('finds the header on the routed 401 and not on the unrouted 404', async () => {
    const { signals, requests } = await runWith({
      [ROUTE_KEYS['get-models']]: edge401('get-models', [WASM]),
      [UNROUTED_KEY]: exchange(404),
    })

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'routed-only',
      calibration: 'heuristic',
      llr: { platform: { 'first-party': 0.3 }, translation: { direct: 0.2 } },
    })
    expect(signals[0]?.observed).toContain('"v0.1"')
    expect(requests.map((request) => request.path)).toEqual(['models', 'nonexistent-n0nce7test'])
  })

  it('weighs the header less when the unrouted 404 carries it too', async () => {
    const { signals } = await runWith({
      [ROUTE_KEYS['get-models']]: edge401('get-models', [WASM]),
      [UNROUTED_KEY]: exchange(404, '', [WASM]),
    })

    expect(signals[0]).toMatchObject({
      signalId: 'present',
      llr: { platform: { 'first-party': 0.1 } },
    })
    expect(signals[0]?.observed).toContain('with the header as well')
  })

  it('weighs the header less when the unrouted path is not a 404', async () => {
    const { signals } = await runWith({
      [ROUTE_KEYS['get-models']]: edge401('get-models', [WASM]),
      [UNROUTED_KEY]: exchange(401, '', [WASM]),
    })

    expect(signals[0]?.signalId).toBe('present')
    expect(signals[0]?.observed).toContain('answered 401')
    expect(signals[0]?.observed).not.toContain('as well')
  })

  it('says nothing, and asks nothing more, when the routed 401 has no such header', async () => {
    const { signals, requests } = await runWith({
      [ROUTE_KEYS['get-models']]: edge401('get-models'),
    })

    expect(signals).toEqual([])
    expect(requests).toHaveLength(1)
  })

  it('says nothing when the routed path does not answer 401', async () => {
    const { signals } = await runWith({
      [ROUTE_KEYS['get-models']]: exchange(200, '{}', [WASM]),
    })

    expect(signals).toEqual([])
  })
})
