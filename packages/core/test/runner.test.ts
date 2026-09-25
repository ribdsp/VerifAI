import { describe, expect, it } from 'vitest'
import { ProbeNotApplicable, RunStopped } from '../src/runner/errors.js'
import { DEFAULT_RETRY_WAIT_MS } from '../src/runner/retry.js'
import { MAX_PROBE_ERROR_MESSAGE, type RunOptions, runProbes } from '../src/runner/run.js'
import type { RunEvent } from '../src/runner/types.js'
import type { TransportResult } from '../src/transport/types.js'
import { probeTarget } from './fakes/context.js'
import { type Harness, harness } from './fakes/environment.js'
import { customProbe, MESSAGES_REQUEST, testProbe, testSignal } from './fakes/probes.js'
import { failure, fakeTransport, jsonResponse, response } from './fakes/transport.js'

const KEY = ['sk', 'ant', 'api03', 'runnertestkey0123456789abcdef'].join('-')

function options(
  answer: (index: number) => TransportResult,
  overrides: Partial<RunOptions> = {},
): { readonly run: RunOptions; readonly events: RunEvent[]; readonly h: Harness } {
  let index = 0
  const events: RunEvent[] = []
  const h = harness()
  const transport = fakeTransport(() => {
    const result = answer(index)
    index += 1
    return result
  })
  return {
    events,
    h,
    run: {
      target: probeTarget(),
      transport,
      apiKey: KEY,
      probes: [testProbe('conformance/test/one')],
      maxRequests: 50,
      maxTokens: 1000,
      nonce: 'abcdefgh12',
      environment: h.environment,
      onEvent: (event) => events.push(event),
      ...overrides,
    },
  }
}

describe('runProbes', () => {
  it('runs a probe and keeps its signals, evidence and outcome', async () => {
    const { run, events } = options(() => jsonResponse(200, { ok: true }))
    const result = await runProbes(run)

    expect(result.signals).toHaveLength(1)
    expect(result.skipped).toEqual([])
    expect(result.outcomes).toEqual([
      { probeId: 'conformance/test/one', group: 'A', status: 'ran' },
    ])
    expect(result.requests).toBe(1)
    expect(result.tokens).toBe(10)
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]?.status).toBe(200)
    expect(result.evidence[0]?.requestDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.aborted).toBe(false)
    expect(Object.isFrozen(result)).toBe(true)
    expect(events.map((event) => event.kind)).toEqual([
      'probe-started',
      'request',
      'probe-finished',
    ])
  })

  it('sends the buyer key by default and none when the run has none', async () => {
    const withKey = options(() => response(200))
    await runProbes(withKey.run)
    const sent = (withKey.run.transport as ReturnType<typeof fakeTransport>).requests[0]
    expect(sent?.headers.some(([, value]) => value === KEY)).toBe(true)

    const without = options(() => response(200))
    const { apiKey: _, ...rest } = without.run
    await runProbes(rest)
    const bare = (without.run.transport as ReturnType<typeof fakeTransport>).requests[0]
    expect(bare?.headers.some(([name]) => name.toLowerCase() === 'x-api-key')).toBe(false)
  })

  it("sends the key in the target's scheme wherever the protocol takes it", async () => {
    const crossed = testProbe('conformance/test/crossed', {
      requests: [
        MESSAGES_REQUEST,
        { ...MESSAGES_REQUEST, protocol: 'openai-chat', path: 'chat/completions' },
      ],
    })
    const bearer = options(() => response(200), {
      probes: [crossed],
      target: { ...probeTarget(), auth: 'bearer' },
    })
    await runProbes(bearer.run)
    const sent = (bearer.run.transport as ReturnType<typeof fakeTransport>).requests
    for (const request of sent) {
      expect(request.headers).toContainEqual(['Authorization', `Bearer ${KEY}`])
      expect(request.headers.map(([name]) => name.toLowerCase())).not.toContain('x-api-key')
    }

    const keyed = options(() => response(200), {
      probes: [crossed],
      target: { ...probeTarget(), auth: 'x-api-key' },
    })
    await runProbes(keyed.run)
    const [messages, chat] = (keyed.run.transport as ReturnType<typeof fakeTransport>).requests
    expect(messages?.headers).toContainEqual(['X-Api-Key', KEY])
    expect(chat?.headers).toContainEqual(['Authorization', `Bearer ${KEY}`])
  })

  it("lets a probe's own scheme win over the target's", async () => {
    const probe = testProbe('conformance/test/own-scheme', {
      requests: [{ ...MESSAGES_REQUEST, auth: 'x-api-key' }],
    })
    const { run } = options(() => response(200), {
      probes: [probe],
      target: { ...probeTarget(), auth: 'bearer' },
    })
    await runProbes(run)
    const [sent] = (run.transport as ReturnType<typeof fakeTransport>).requests
    expect(sent?.headers).toContainEqual(['X-Api-Key', KEY])
  })

  it('keeps the key out of every request digest', async () => {
    const first = options(() => response(200))
    const second = options(() => response(200), {
      apiKey: ['sk', 'ant', 'api03', 'anotherkey9876543210zyxwvu'].join('-'),
    })
    const a = await runProbes(first.run)
    const b = await runProbes(second.run)
    expect(a.evidence[0]?.requestDigest).toBe(b.evidence[0]?.requestDigest)
  })

  it('treats a probe that asks for the key in a run without one as its own bug', async () => {
    const probe = testProbe('conformance/test/keyed', {
      requests: [{ ...MESSAGES_REQUEST, credential: 'buyer' }],
    })
    const { run, events } = options(() => response(200), { probes: [probe] })
    const { apiKey: _, ...rest } = run
    const result = await runProbes(rest)
    expect(result.skipped).toEqual([{ probeId: probe.id, reason: 'probe-error' }])
    expect(events.some((event) => event.kind === 'probe-error')).toBe(true)
  })

  it('stops the run on a 401 to the buyer key', async () => {
    const { run } = options(() => jsonResponse(401, { type: 'error' }))
    await expect(runProbes(run)).rejects.toMatchObject({ reason: 'invalid-key' })
  })

  it('hands a provoked 401 to the probe', async () => {
    const probe = testProbe('conformance/test/provoked', {
      requests: [{ ...MESSAGES_REQUEST, provokes: [401] }],
    })
    const { run } = options(() => response(401), { probes: [probe] })
    const result = await runProbes(run)
    expect(result.outcomes[0]?.status).toBe('ran')
  })

  it('loses a probe on a 403 to the buyer key', async () => {
    const { run } = options(() => response(403))
    const result = await runProbes(run)
    expect(result.skipped).toEqual([{ probeId: 'conformance/test/one', reason: 'endpoint-error' }])
  })

  it('stops the run on a 404 that names the claimed model when asked to generate', async () => {
    const probe = testProbe('conformance/test/generate', {
      requests: [{ ...MESSAGES_REQUEST, generates: true }],
    })
    const missing = jsonResponse(404, {
      type: 'error',
      error: { type: 'not_found_error', message: 'model: claude-opus-5-5' },
    })
    const { run } = options(() => missing, { probes: [probe] })
    await expect(runProbes(run)).rejects.toMatchObject({ reason: 'model-not-found' })

    const coded = jsonResponse(404, {
      error: { message: 'nope', type: 'invalid_request_error', code: 'model_not_found' },
    })
    const second = options(() => coded, { probes: [probe] })
    await expect(runProbes(second.run)).rejects.toBeInstanceOf(RunStopped)
  })

  it("stops the run on a 404 that names the gateway's name for the model", async () => {
    const probe = testProbe('conformance/test/generate', {
      requests: [{ ...MESSAGES_REQUEST, generates: true }],
    })
    const missing = jsonResponse(404, {
      type: 'error',
      error: { type: 'not_found_error', message: 'model: reseller/claude-opus-4.6' },
    })
    const target = probeTarget({
      model: 'claude-opus-4-6',
      requestedModel: 'reseller/claude-opus-4.6',
    })
    const { run } = options(() => missing, { probes: [probe], target })
    await expect(runProbes(run)).rejects.toMatchObject({ reason: 'model-not-found' })
  })

  it('hands a 404 that says nothing of the model to the probe', async () => {
    const probe = testProbe('conformance/test/generate', {
      requests: [{ ...MESSAGES_REQUEST, generates: true }],
    })
    const { run } = options(() => response(404), { probes: [probe] })
    const result = await runProbes(run)
    expect(result.outcomes[0]?.status).toBe('ran')
  })

  it('retries a 429 once, after the wait it asks for', async () => {
    const { run, h, events } = options((index) =>
      index === 0 ? response(429, '', [['Retry-After', '2']]) : response(200),
    )
    const result = await runProbes(run)
    expect(result.outcomes[0]?.status).toBe('ran')
    expect(h.slept).toEqual([2000])
    expect(result.evidence.map((entry) => entry.retry)).toEqual([undefined, true])
    expect(events).toContainEqual({
      kind: 'waiting',
      probeId: 'conformance/test/one',
      waitMs: 2000,
    })
  })

  it('loses a probe that fails twice, or asks to wait too long', async () => {
    const twice = options(() => response(503))
    const result = await runProbes(twice.run)
    expect(result.skipped[0]?.reason).toBe('endpoint-error')
    expect(result.requests).toBe(2)

    const long = options(() => response(429, '', [['Retry-After', '3600']]))
    const refused = await runProbes(long.run)
    expect(refused.skipped[0]?.reason).toBe('endpoint-error')
    expect(refused.requests).toBe(1)
  })

  it('retries a transient transport failure after the default wait', async () => {
    const { run, h } = options((index) => (index === 0 ? failure('timeout', true) : response(200)))
    const result = await runProbes(run)
    expect(result.outcomes[0]?.status).toBe('ran')
    expect(h.slept).toEqual([DEFAULT_RETRY_WAIT_MS])
    expect(result.evidence[0]).toMatchObject({ status: null, failure: 'timeout' })
  })

  it('loses a probe on a failure that is not transient', async () => {
    const { run } = options((index) =>
      index === 0 ? failure('response-too-large', true) : response(200),
    )
    const result = await runProbes({
      ...run,
      probes: [testProbe('conformance/test/one'), testProbe('conformance/test/two')],
    })
    expect(result.skipped).toEqual([{ probeId: 'conformance/test/one', reason: 'endpoint-error' }])
  })

  it('records a blocked target', async () => {
    const { run } = options((index) => (index === 0 ? failure('blocked-target') : response(200)))
    const result = await runProbes({
      ...run,
      probes: [testProbe('conformance/test/one'), testProbe('conformance/test/two')],
    })
    expect(result.skipped).toEqual([{ probeId: 'conformance/test/one', reason: 'blocked' }])
  })

  it('stops a run in which no request reached the endpoint', async () => {
    const { run } = options(() => failure('connection-failed'))
    await expect(runProbes(run)).rejects.toMatchObject({ reason: 'unreachable' })
  })

  it('does not call a run unreachable when it sent nothing', async () => {
    const probe = customProbe('conformance/test/silent', async () => [])
    const { run } = options(() => response(200), { probes: [probe] })
    const result = await runProbes(run)
    expect(result.requests).toBe(0)
  })

  it('skips what the budget cannot pay for, and runs what it can', async () => {
    const { run } = options(() => response(200), {
      maxRequests: 1,
      probes: [testProbe('conformance/test/one'), testProbe('conformance/test/two')],
    })
    const result = await runProbes(run)
    expect(result.skipped).toEqual([{ probeId: 'conformance/test/two', reason: 'budget-exceeded' }])

    const tokens = options(() => response(200), { maxTokens: 5 })
    const poor = await runProbes(tokens.run)
    expect(poor.skipped[0]?.reason).toBe('budget-exceeded')
    expect(poor.requests).toBe(0)
  })

  it('skips a probe that finds nothing to measure as not applicable', async () => {
    const probe = customProbe('conformance/test/na', async (context) => {
      await context.send(MESSAGES_REQUEST)
      throw new ProbeNotApplicable()
    })
    const { run } = options(() => response(200), { probes: [probe] })
    const result = await runProbes(run)
    expect(result.skipped).toEqual([{ probeId: probe.id, reason: 'not-applicable' }])
  })

  it('marks every probe after a cancellation as aborted', async () => {
    const controller = new AbortController()
    const first = customProbe('conformance/test/first', async (context) => {
      await context.send(MESSAGES_REQUEST)
      controller.abort()
      return [testSignal('conformance/test/first')]
    })
    const { run } = options(() => response(200), {
      signal: controller.signal,
      probes: [first, testProbe('conformance/test/two'), testProbe('conformance/test/three')],
    })
    const result = await runProbes(run)
    expect(result.aborted).toBe(true)
    expect(result.outcomes.map((outcome) => outcome.reason)).toEqual([
      undefined,
      'aborted',
      'aborted',
    ])
  })

  it('maps a cancellation inside a probe to aborted', async () => {
    const controller = new AbortController()
    const probe = customProbe('conformance/test/cancelled', async (context) => {
      controller.abort()
      await context.send(MESSAGES_REQUEST)
      return []
    })
    const { run } = options(() => response(200), { signal: controller.signal, probes: [probe] })
    const result = await runProbes(run)
    expect(result.skipped).toEqual([{ probeId: probe.id, reason: 'aborted' }])
    expect(result.aborted).toBe(true)
  })

  it('turns a probe that throws into a probe-error with the key redacted', async () => {
    const probe = customProbe('conformance/test/buggy', async () => {
      throw new Error(`broke while holding ${KEY} ${'x'.repeat(400)}`)
    })
    const { run, events } = options(() => response(200), { probes: [probe] })
    const result = await runProbes(run)
    expect(result.skipped).toEqual([{ probeId: probe.id, reason: 'probe-error' }])
    const reported = events.find((event) => event.kind === 'probe-error')
    expect(reported).toBeDefined()
    const message = reported?.kind === 'probe-error' ? reported.message : ''
    expect(message).not.toContain(KEY)
    expect(message.length).toBeLessThanOrEqual(MAX_PROBE_ERROR_MESSAGE)
  })

  it('refuses signals a probe did not build for itself', async () => {
    const cases = [
      customProbe('conformance/test/other', async () => [testSignal('conformance/test/else')]),
      customProbe('conformance/test/loose', async () => [
        { ...testSignal('conformance/test/loose') },
      ]),
      customProbe('conformance/test/twice', async () => [
        testSignal('conformance/test/twice'),
        testSignal('conformance/test/twice'),
      ]),
      customProbe(
        'conformance/test/shape',
        async () => ({}) as unknown as ReturnType<typeof testSignal>[],
      ),
    ]
    for (const probe of cases) {
      const { run } = options(() => response(200), { probes: [probe] })
      const result = await runProbes(run)
      expect(result.skipped).toEqual([{ probeId: probe.id, reason: 'probe-error' }])
      expect(result.signals).toEqual([])
    }
  })

  it('shares a computation between probes, and forgets one that failed', async () => {
    let computed = 0
    let failed = 0
    const sharing = (id: string) =>
      customProbe(id, async (context) => {
        await context.shared('test/value', async () => {
          computed += 1
          return 1
        })
        await context
          .shared('test/broken', async () => {
            failed += 1
            throw new Error('once')
          })
          .catch(() => undefined)
        return []
      })
    const { run } = options(() => response(200), {
      probes: [sharing('conformance/test/a'), sharing('conformance/test/b')],
    })
    await runProbes(run)
    expect(computed).toBe(1)
    expect(failed).toBe(2)
  })

  it('refuses options it cannot run with', async () => {
    const { run } = options(() => response(200))
    await expect(runProbes({ ...run, nonce: 'SHORT' })).rejects.toThrow(TypeError)
    await expect(runProbes({ ...run, maxRequests: -1 })).rejects.toThrow(TypeError)
    await expect(runProbes({ ...run, maxTokens: 1.5 })).rejects.toThrow(TypeError)
    await expect(runProbes({ ...run, draws: 0 })).rejects.toThrow(TypeError)
    await expect(runProbes({ ...run, spreadMs: -5 })).rejects.toThrow(TypeError)
    await expect(
      runProbes({ ...run, probes: [testProbe('conformance/x'), testProbe('conformance/x')] }),
    ).rejects.toThrow(TypeError)
  })
})
