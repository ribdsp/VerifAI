import { describe, expect, it } from 'vitest'
import { routeSerializers } from '../../../../src/probes/conformance/openai/route-serializers.js'
import { NO_KEY_ROUTES } from '../../../../src/probes/conformance/openai/shared.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { MEASURED_OPENAI_ROUTE_SERIALIZERS } from '../../../../src/sources/measured-conformance.js'
import { exchange, probeContext } from '../../../fakes/context.js'
import { byRoute, edge401, errorText, jsonText, ROUTE_KEYS } from './edge.js'

const OPENAI_EDGE: Readonly<Record<string, Exchange>> = Object.fromEntries(
  NO_KEY_ROUTES.map((route) => [ROUTE_KEYS[route], edge401(route)]),
)

function everyRoute(answer: Exchange): Readonly<Record<string, Exchange>> {
  return Object.fromEntries(NO_KEY_ROUTES.map((route) => [ROUTE_KEYS[route], answer]))
}

async function runWith(answers: Readonly<Record<string, Exchange>>) {
  const fake = probeContext(byRoute(answers), { protocol: 'openai-chat' })
  const signals = await routeSerializers.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/openai/route-serializers', () => {
  it("matches when every route answers in OpenAI's own layout and words", async () => {
    const { signals, requests } = await runWith(OPENAI_EDGE)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      probeId: 'conformance/openai/route-serializers',
      signalId: 'match',
      calibration: 'heuristic',
      llr: { platform: { 'first-party': 0.3 }, translation: { direct: 0.3 } },
      citations: [MEASURED_OPENAI_ROUTE_SERIALIZERS],
    })
    expect(signals[0]?.observed).toContain('GET models: indent-2')
    expect(signals[0]?.observed).not.toContain('unlike OpenAI')
    expect(Object.isFrozen(signals[0])).toBe(true)
    expect(requests).toHaveLength(4)
    expect(requests.every((request) => request.credential === 'none')).toBe(true)
    expect(requests.every((request) => request.provokes?.includes(401))).toBe(true)
  })

  it('still matches when one route does not answer 401 and the other three agree', async () => {
    const { signals } = await runWith({
      ...OPENAI_EDGE,
      [ROUTE_KEYS['post-responses']]: exchange(404),
    })

    expect(signals[0]?.signalId).toBe('match')
  })

  it('calls two matching routes a partial match: too few for a full one', async () => {
    const { signals } = await runWith({
      [ROUTE_KEYS['get-models']]: edge401('get-models'),
      [ROUTE_KEYS['post-responses']]: edge401('post-responses'),
    })

    expect(signals[0]).toMatchObject({
      signalId: 'partial-match',
      llr: { platform: { 'first-party': 0.1 } },
    })
    expect(signals[0]?.plainLanguage).toContain('2 of 2 routes')
  })

  it('calls a mixture a partial match and says which routes differ', async () => {
    const { signals } = await runWith({
      ...OPENAI_EDGE,
      [ROUTE_KEYS['post-chat-completions']]: jsonText(401, errorText('Invalid key', 4)),
      [ROUTE_KEYS['get-models']]: jsonText(
        401,
        errorText('Missing bearer authentication in header'),
      ),
    })

    expect(signals[0]?.signalId).toBe('partial-match')
    expect(signals[0]?.observed).toContain('GET models: compact')
    expect(signals[0]?.observed).toContain('unlike OpenAI')
  })

  it('reports a mismatch when every route answers in one serializer of its own', async () => {
    const { signals } = await runWith(everyRoute(jsonText(401, errorText('Invalid API key'))))

    expect(signals[0]).toMatchObject({
      signalId: 'mismatch',
      llr: { platform: { 'first-party': -0.1 } },
    })
  })

  it('reads a 401 that is not JSON as a mismatch on that route', async () => {
    const { signals } = await runWith(everyRoute(exchange(401, 'Unauthorized')))

    expect(signals[0]?.signalId).toBe('mismatch')
    expect(signals[0]?.observed).toContain('not JSON')
  })

  it('says nothing when no route answers 401', async () => {
    const { signals } = await runWith({})

    expect(signals).toEqual([])
  })
})
