import { describe, expect, it } from 'vitest'
import { cors } from '../../../../src/probes/conformance/openai/cors.js'
import type { Exchange } from '../../../../src/probes/types.js'
import {
  MEASURED_OPENAI_EXPOSE_HEADERS_TWICE,
  MEASURED_OPENAI_PREFLIGHT,
} from '../../../../src/sources/measured-conformance.js'
import type { HeaderPair } from '../../../../src/transport/types.js'
import { exchange, probeContext } from '../../../fakes/context.js'
import { byRoute, edge401, ROUTE_KEYS } from './edge.js'

const PREFLIGHT_KEY = 'OPTIONS chat/completions'

const OPENAI_PREFLIGHT: readonly HeaderPair[] = [
  ['access-control-allow-methods', 'GET, OPTIONS, POST'],
  ['access-control-max-age', '86400'],
]

const EXPOSED_TWICE: readonly HeaderPair[] = [
  ['Access-Control-Expose-Headers', 'CF-Ray'],
  ['Access-Control-Expose-Headers', 'CF-Ray'],
]

async function runWith(answers: Readonly<Record<string, Exchange>>) {
  // A preflight whose headers are hidden, as a browser hides them, unless a test says otherwise.
  const fake = probeContext(byRoute({ [PREFLIGHT_KEY]: exchange(200), ...answers }), {
    protocol: 'openai-chat',
  })
  const signals = await cors.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/openai/cors', () => {
  it("finds OpenAI's preflight and its doubled expose header", async () => {
    const { signals, requests } = await runWith({
      [PREFLIGHT_KEY]: exchange(200, '', OPENAI_PREFLIGHT),
      [ROUTE_KEYS['get-models']]: edge401('get-models', EXPOSED_TWICE),
    })

    expect(signals.map((found) => found.signalId)).toEqual([
      'preflight-match',
      'expose-headers-duplicated',
    ])
    expect(signals[0]).toMatchObject({
      llr: { platform: { 'first-party': 0.2 }, translation: { direct: 0.1 } },
      citations: [MEASURED_OPENAI_PREFLIGHT],
    })
    expect(signals[1]).toMatchObject({
      llr: { platform: { 'first-party': 0.2 } },
      citations: [MEASURED_OPENAI_EXPOSE_HEADERS_TWICE],
    })
    expect(signals[1]?.observed).toContain('2 times')
    expect(requests[0]).toMatchObject({ path: 'chat/completions', method: 'OPTIONS' })
    expect(requests[0]?.credential).toBe('none')
    expect(requests[0]?.headers).toContainEqual(['Access-Control-Request-Method', 'POST'])
  })

  it('counts a doubled header that arrives comma-joined', async () => {
    const { signals } = await runWith({
      [ROUTE_KEYS['get-models']]: edge401('get-models', [
        ['Access-Control-Expose-Headers', 'CF-Ray, cf-ray'],
      ]),
    })

    expect(signals.map((found) => found.signalId)).toEqual(['expose-headers-duplicated'])
  })

  it('says nothing about a header exposed once, or on a response that is not the 401', async () => {
    const once = await runWith({
      [ROUTE_KEYS['get-models']]: edge401('get-models', [
        ['Access-Control-Expose-Headers', 'CF-Ray'],
      ]),
    })
    const notThe401 = await runWith({
      [ROUTE_KEYS['get-models']]: exchange(403, '', EXPOSED_TWICE),
    })

    expect(once.signals).toEqual([])
    expect(notThe401.signals).toEqual([])
  })

  it('reads a refused preflight as a mismatch', async () => {
    const { signals } = await runWith({ [PREFLIGHT_KEY]: exchange(403) })

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'preflight-mismatch',
      llr: { platform: { 'first-party': -0.1 } },
    })
    expect(signals[0]?.observed).toContain('access-control-allow-methods: absent')
  })

  it('reads different preflight values as a mismatch', async () => {
    const methods = await runWith({
      [PREFLIGHT_KEY]: exchange(204, '', [['access-control-allow-methods', '*']]),
    })
    const maxAge = await runWith({
      [PREFLIGHT_KEY]: exchange(200, '', [
        ['access-control-allow-methods', 'GET, OPTIONS, POST'],
        ['access-control-max-age', '600'],
      ]),
    })

    expect(methods.signals[0]?.signalId).toBe('preflight-mismatch')
    expect(methods.signals[0]?.observed).toContain('"*"')
    expect(maxAge.signals[0]?.signalId).toBe('preflight-mismatch')
  })

  it('says nothing about a preflight whose headers it cannot see', async () => {
    const { signals } = await runWith({ [PREFLIGHT_KEY]: exchange(200) })

    expect(signals).toEqual([])
  })
})
