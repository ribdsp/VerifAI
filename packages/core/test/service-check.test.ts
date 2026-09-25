import { describe, expect, it } from 'vitest'
import type { AnyProbe } from '../src/probes/types.js'
import { BEARER_HINT, type CheckEnvironment, prepareCheck } from '../src/service/check.js'
import type { CheckRequest } from '../src/service/contract.js'
import type { TransportResult } from '../src/transport/types.js'
import { harness } from './fakes/environment.js'
import { testDilutionProbe, testProbe } from './fakes/probes.js'
import { failure, fakeTransport, jsonResponse } from './fakes/transport.js'

const KEY = ['sk', 'ant', 'api03', 'checktestkey0123456789abcdefgh'].join('-')

const CATALOGUE: readonly AnyProbe[] = Object.freeze([
  testProbe('conformance/test/free'),
  testProbe('accounting/test/keyed', { group: 'B', needsKey: true }),
  testDilutionProbe(),
])

function request(overrides: Partial<CheckRequest> = {}): CheckRequest {
  return {
    endpoint: 'https://gateway.example/v1',
    apiKey: KEY,
    model: 'claude-opus-5-5',
    vendor: 'anthropic',
    protocol: 'anthropic-messages',
    profile: 'standard',
    ...overrides,
  }
}

function environment(
  answer: () => TransportResult = () => jsonResponse(200, { ok: true }),
  overrides: Partial<CheckEnvironment> = {},
): CheckEnvironment {
  let drawn = 0
  return {
    transport: fakeTransport(answer),
    dilutionSupported: true,
    toolVersion: '0.1.0',
    catalogue: CATALOGUE,
    randomId: (length) => {
      drawn += 1
      return String(drawn).repeat(length).slice(0, length)
    },
    ...overrides,
  }
}

async function prepared(overrides: Partial<CheckRequest> = {}, env = environment()) {
  const preparation = await prepareCheck(request(overrides), env)
  if (!preparation.ok) {
    throw new Error(`Test check refused: ${preparation.error.code}`)
  }
  return preparation.check
}

const clock = () => {
  let now = Date.parse('2026-09-24T10:00:00Z')
  return () => {
    now += 1000
    return now
  }
}

describe('prepareCheck', () => {
  it('estimates the plan, with the draws and the warnings', async () => {
    const check = await prepared({ maxRequests: 100 })
    expect(check.estimate).toEqual({
      protocol: 'anthropic-messages',
      vendor: 'anthropic',
      pairing: 'native',
      auth: 'x-api-key',
      profile: 'standard',
      requests: check.plan.requests,
      tokens: 20,
      maxRequests: 100,
      maxTokens: 40_000,
      draws: 30,
      spreadMs: 0,
      probes: [
        { id: 'conformance/test/free', title: 'Test probe conformance/test/free', group: 'A' },
        { id: 'accounting/test/keyed', title: 'Test probe accounting/test/keyed', group: 'B' },
        { id: 'dilution/test', title: 'Test dilution probe', group: 'F' },
      ],
      skipped: [],
      warnings: [],
    })
    expect(Object.isFrozen(check.estimate)).toBe(true)
  })

  it('warns of what the plan leaves out', async () => {
    const check = await prepared(
      { apiKey: undefined, maxRequests: 1 },
      environment(undefined, { dilutionSupported: false }),
    )
    expect(check.estimate.skipped).toEqual([
      { probeId: 'accounting/test/keyed', reason: 'needs-api-key' },
      { probeId: 'dilution/test', reason: 'unsupported-by-transport' },
    ])
    expect(check.estimate.warnings).toEqual(['no-api-key', 'dilution-unsupported'])
    expect(check.estimate.draws).toBe(0)
  })

  it('passes a refusal through with nothing sent', async () => {
    const env = environment()
    const preparation = await prepareCheck(request({ model: '' }), env)
    expect(preparation).toMatchObject({ ok: false, error: { code: 'invalid-model' } })
  })

  it('keeps the key out of everything it returns', async () => {
    const check = await prepared()
    expect(JSON.stringify(check)).not.toContain(KEY)
    expect(Object.values(check).some((value) => value === KEY)).toBe(false)
    expect(Object.isFrozen(check)).toBe(true)
  })
})

describe('PreparedCheck.execute', () => {
  it('runs, scores and reports, with the key redacted from the report', async () => {
    const check = await prepared()
    const events: string[] = []
    const outcome = await check.execute({
      now: clock(),
      environment: harness().environment,
      onEvent: (event) => events.push(event.kind),
    })
    expect(outcome.state).toBe('finished')
    if (outcome.state !== 'finished') {
      return
    }
    const { report } = outcome
    expect(report.run).toMatchObject({
      startedAt: '2026-09-24T10:00:01.000Z',
      finishedAt: '2026-09-24T10:00:02.000Z',
      profile: 'standard',
      nonce: '222222222222222222222222',
      probeOrderSeed: '111111111111111111111111',
      privateTargetsAllowed: false,
    })
    expect(report.target.endpoint).toBeNull()
    expect(report.tool).toEqual({ name: 'verifai', version: '0.1.0' })
    expect(JSON.stringify(report)).not.toContain(KEY)
    expect(outcome.requests).toBeGreaterThan(0)
    expect(events).toContain('probe-finished')
  })

  it("puts the planner's skips in the report ahead of the run's", async () => {
    const check = await prepared({ apiKey: '' })
    const outcome = await check.execute({ environment: harness().environment })
    expect(outcome.state === 'finished' && outcome.report.skipped[0]).toEqual({
      probeId: 'accounting/test/keyed',
      reason: 'needs-api-key',
    })
  })

  it('records how the key was sent, in the estimate and in the report', async () => {
    const check = await prepared({ auth: 'bearer' })
    const outcome = await check.execute({ environment: harness().environment })

    expect(check.estimate.auth).toBe('bearer')
    expect(outcome.state === 'finished' && outcome.report.target.auth).toBe('bearer')
  })

  it('publishes the endpoint only when asked', async () => {
    const check = await prepared({ showEndpoint: true })
    const outcome = await check.execute({ environment: harness().environment })
    expect(outcome.state === 'finished' && outcome.report.target.endpoint).toBe(
      'https://gateway.example/v1',
    )
  })

  it('stops on a refused key, with the reason the buyer can act on', async () => {
    const check = await prepared(
      {},
      environment(() => jsonResponse(401, { type: 'error' })),
    )
    const outcome = await check.execute({ environment: harness().environment })
    expect(outcome).toEqual({
      state: 'stopped',
      error: { code: 'invalid-key', message: expect.any(String) },
      suggestsBearer: true,
    })
  })

  it('suggests a bearer token when the Messages API refused the key as x-api-key', async () => {
    const refused = () => jsonResponse(401, { type: 'error' })
    const stopOf = async (overrides: Partial<CheckRequest>) => {
      const check = await prepared(overrides, environment(refused))
      const outcome = await check.execute({ environment: harness().environment })
      return outcome.state === 'stopped'
        ? { hinted: outcome.error.message.includes(BEARER_HINT), flag: outcome.suggestsBearer }
        : undefined
    }
    const both = (value: boolean) => ({ hinted: value, flag: value })

    expect(await stopOf({})).toEqual(both(true))
    expect(await stopOf({ auth: 'x-api-key' })).toEqual(both(true))
    expect(await stopOf({ auth: 'bearer' })).toEqual(both(false))
    expect(await stopOf({ protocol: 'openai-chat' })).toEqual(both(false))
  })

  it('stops when nothing reached the endpoint', async () => {
    const check = await prepared(
      {},
      environment(() => failure('connection-failed')),
    )
    const outcome = await check.execute({ environment: harness().environment })
    expect(outcome.state === 'stopped' && outcome.error.code).toBe('unreachable')
  })

  it('reports a cancelled run as cancelled, not as a verdict', async () => {
    const check = await prepared()
    const controller = new AbortController()
    controller.abort()
    const outcome = await check.execute({
      signal: controller.signal,
      environment: harness().environment,
    })
    expect(outcome).toMatchObject({ state: 'cancelled' })
  })

  it('fails closed on its own bugs, redacting the detail', async () => {
    const check = await prepared()
    const outcome = await check.execute({
      now: () => {
        throw new Error(`clock broke near ${KEY}`)
      },
    })
    expect(outcome).toMatchObject({ state: 'failed', error: { code: 'internal' } })
    expect(outcome.state === 'failed' && outcome.detail).toMatch(/^Error: clock broke near /)
    expect(JSON.stringify(outcome)).not.toContain(KEY)
  })

  it('runs once, and not at all once discarded', async () => {
    const check = await prepared()
    await check.execute({ environment: harness().environment })
    await expect(check.execute()).rejects.toThrow('runs once')

    const dropped = await prepared()
    dropped.discard()
    await expect(dropped.execute()).rejects.toThrow('runs once')
  })
})
