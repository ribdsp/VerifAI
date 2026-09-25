import type { Preparation, RunEvent } from '@verifai/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CHECK_ID_LENGTH,
  type CheckStore,
  createCheckStore,
  MAX_EVENTS_PER_RESPONSE,
  MAX_FINISHED_CHECKS,
} from '../src/daemon/checks.js'
import { controlledCheck, flush, realCheck, realReport } from './support/checks.js'
import { KEY } from './support/context.js'

const stores: CheckStore[] = []

function store(options: Parameters<typeof createCheckStore>[0] = {}): CheckStore {
  const created = createCheckStore(options)
  stores.push(created)
  return created
}

afterEach(() => {
  for (const created of stores.splice(0)) {
    created.close()
  }
})

const ready = (preparation: Preparation) => async () => preparation

async function created(checks: CheckStore, preparation: Preparation): Promise<string> {
  const result = await checks.create(ready(preparation))
  if (result.kind !== 'created') {
    throw new Error(`Expected a created check, got ${result.kind}`)
  }
  return result.response.checkId
}

const PROBE_FINISHED: RunEvent = Object.freeze({
  kind: 'probe-finished',
  probeId: 'conformance/test/free',
  status: 'ran',
  signals: 1,
})
const REQUEST_SENT: RunEvent = Object.freeze({
  kind: 'request',
  probeId: 'conformance/test/free',
  status: 200,
  tokens: 12,
})

describe('createCheckStore', () => {
  it('holds a prepared check under a fresh id, with its estimate', async () => {
    const checks = store()
    const check = await realCheck()
    const result = await checks.create(ready({ ok: true, check }))
    if (result.kind !== 'created') {
      throw new Error(result.kind)
    }
    expect(result.response.checkId).toMatch(new RegExp(`^[a-z0-9]{${CHECK_ID_LENGTH}}$`))
    expect(result.response.estimate).toBe(check.estimate)
    expect(checks.status(result.response.checkId, 0)).toEqual({
      checkId: result.response.checkId,
      state: 'prepared',
      progress: { done: 0, total: check.estimate.probes.length, requests: 0, tokens: 0 },
      events: [],
      nextEvent: 0,
    })
  })

  it('passes a refusal through as refused', async () => {
    const error = { code: 'invalid-endpoint', message: 'endpoint: bad' } as const
    expect(await store().create(ready({ ok: false, error }))).toEqual({ kind: 'refused', error })
  })

  it('is busy while another check is being prepared', async () => {
    const checks = store()
    let finish: (preparation: Preparation) => void = () => undefined
    const first = checks.create(
      () =>
        new Promise<Preparation>((resolve) => {
          finish = resolve
        }),
    )
    expect(await checks.create(ready({ ok: true, check: await realCheck() }))).toEqual({
      kind: 'busy',
    })
    finish({ ok: true, check: await realCheck() })
    expect((await first).kind).toBe('created')
  })

  it('is busy while a check is running, and prepares nothing', async () => {
    const checks = store()
    const running = await controlledCheck()
    const checkId = await created(checks, { ok: true, check: running.check })
    expect(checks.start(checkId)).toBe('ok')

    let prepared = false
    const result = await checks.create(async () => {
      prepared = true
      return { ok: true, check: await realCheck() }
    })
    expect(result).toEqual({ kind: 'busy' })
    expect(prepared).toBe(false)
  })

  it('discards a check prepared while another one started', async () => {
    const checks = store()
    const first = await controlledCheck()
    const firstId = await created(checks, { ok: true, check: first.check })
    const late = await controlledCheck()
    let finish: (preparation: Preparation) => void = () => undefined
    const second = checks.create(
      () =>
        new Promise<Preparation>((resolve) => {
          finish = resolve
        }),
    )
    expect(checks.start(firstId)).toBe('ok')
    finish({ ok: true, check: late.check })
    expect(await second).toEqual({ kind: 'busy' })
    expect(late.discarded()).toBe(true)
  })

  it('replaces a prepared check that was never started, dropping its key', async () => {
    const checks = store()
    const older = await controlledCheck()
    const olderId = await created(checks, { ok: true, check: older.check })
    const newerId = await created(checks, { ok: true, check: (await controlledCheck()).check })

    expect(older.discarded()).toBe(true)
    expect(checks.status(olderId, 0)?.state).toBe('cancelled')
    expect(checks.start(olderId)).toBe('conflict')
    expect(checks.status(newerId, 0)?.state).toBe('prepared')
  })

  it('drops a prepared check once its time is up', async () => {
    const checks = store({ preparedTtlMs: 5 })
    const idle = await controlledCheck()
    const checkId = await created(checks, { ok: true, check: idle.check })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(checks.status(checkId, 0)?.state).toBe('cancelled')
    expect(idle.discarded()).toBe(true)
    expect(checks.start(checkId)).toBe('conflict')
  })

  it('runs a started check to its report', async () => {
    const at = () => 1_800_000_000_000
    const checks = store({ now: at })
    const run = await controlledCheck()
    const checkId = await created(checks, { ok: true, check: run.check })

    expect(checks.start(checkId)).toBe('ok')
    expect(checks.start(checkId)).toBe('conflict')
    expect(checks.status(checkId, 0)?.state).toBe('running')
    expect(checks.report(checkId)).toEqual({ kind: 'conflict' })
    expect(run.started()?.now).toBe(at)

    const report = await realReport()
    run.settle({ state: 'finished', report, requests: 7, tokens: 40 })
    await flush()

    const status = checks.status(checkId, 0)
    expect(status?.state).toBe('finished')
    expect(status?.report).toBe(report)
    expect(status?.progress).toMatchObject({ requests: 7, tokens: 40 })
    expect(checks.report(checkId)).toEqual({ kind: 'ok', report })
  })

  it('counts the run’s events into its progress and pages them out', async () => {
    const checks = store()
    const run = await controlledCheck()
    const checkId = await created(checks, { ok: true, check: run.check })
    checks.start(checkId)
    const emit = run.started()?.onEvent ?? (() => undefined)

    emit(REQUEST_SENT)
    emit(REQUEST_SENT)
    emit(PROBE_FINISHED)
    const status = checks.status(checkId, 1)
    expect(status?.progress).toMatchObject({ done: 1, requests: 2, tokens: 24 })
    expect(status?.events).toEqual([
      { seq: 1, event: REQUEST_SENT },
      { seq: 2, event: PROBE_FINISHED },
    ])
    expect(status?.nextEvent).toBe(3)
    // A cursor past the end is where the log ends, not an error.
    expect(checks.status(checkId, 99)).toMatchObject({ events: [], nextEvent: 3 })
  })

  it(`returns at most ${MAX_EVENTS_PER_RESPONSE} events at a time`, async () => {
    const checks = store()
    const run = await controlledCheck()
    const checkId = await created(checks, { ok: true, check: run.check })
    checks.start(checkId)
    const emit = run.started()?.onEvent ?? (() => undefined)
    for (let index = 0; index < MAX_EVENTS_PER_RESPONSE + 100; index += 1) {
      emit(REQUEST_SENT)
    }

    const first = checks.status(checkId, 0)
    expect(first?.events).toHaveLength(MAX_EVENTS_PER_RESPONSE)
    expect(first?.nextEvent).toBe(MAX_EVENTS_PER_RESPONSE)
    const rest = checks.status(checkId, first?.nextEvent ?? 0)
    expect(rest?.events).toHaveLength(100)
    expect(rest?.events[0]?.seq).toBe(MAX_EVENTS_PER_RESPONSE)
  })

  it('cancels a prepared check at once and a running one when it stops', async () => {
    const checks = store()
    const idle = await controlledCheck()
    const idleId = await created(checks, { ok: true, check: idle.check })
    expect(checks.cancel(idleId)).toBe('cancelled')
    expect(idle.discarded()).toBe(true)

    const run = await controlledCheck()
    const runId = await created(checks, { ok: true, check: run.check })
    checks.start(runId)
    expect(checks.cancel(runId)).toBe('running')
    expect(run.started()?.signal?.aborted).toBe(true)
    run.settle({ state: 'cancelled', requests: 1, tokens: 0 })
    await flush()
    expect(checks.status(runId, 0)?.state).toBe('cancelled')
    expect(checks.report(runId)).toEqual({ kind: 'conflict' })

    expect(checks.cancel('nosuchcheck')).toBeUndefined()
  })

  it('keeps an endpoint’s refusal as stopped', async () => {
    const checks = store()
    const run = await controlledCheck()
    const checkId = await created(checks, { ok: true, check: run.check })
    checks.start(checkId)
    const error = { code: 'invalid-key', message: 'The endpoint refused the key.' } as const
    run.settle({ state: 'stopped', error, suggestsBearer: false })
    await flush()
    expect(checks.status(checkId, 0)).toMatchObject({ state: 'stopped', error })
  })

  it('logs a failed run’s redacted detail and keeps only the fixed error', async () => {
    const failures: string[] = []
    const checks = store({ onFailure: (detail) => failures.push(detail) })
    const run = await controlledCheck()
    const checkId = await created(checks, { ok: true, check: run.check })
    checks.start(checkId)
    const error = { code: 'internal', message: 'The check failed inside VerifAI.' } as const
    run.settle({ state: 'failed', error, detail: 'probe threw: TypeError' })
    await flush()
    expect(failures).toEqual(['probe threw: TypeError'])
    expect(checks.status(checkId, 0)).toMatchObject({ state: 'failed', error })
  })

  it('treats a rejected run as its own failure, logging the error’s name only', async () => {
    const failures: string[] = []
    const checks = store({ onFailure: (detail) => failures.push(detail) })
    const run = await controlledCheck()
    const checkId = await created(checks, { ok: true, check: run.check })
    checks.start(checkId)
    run.reject(new TypeError(`bad key ${KEY}`))
    await flush()
    expect(failures).toEqual(['execute rejected: TypeError'])
    expect(checks.status(checkId, 0)?.state).toBe('failed')
    expect(JSON.stringify(checks.status(checkId, 0))).not.toContain(KEY)
  })

  it(`keeps only the last ${MAX_FINISHED_CHECKS} finished checks`, async () => {
    const checks = store()
    const ids: string[] = []
    for (let index = 0; index < MAX_FINISHED_CHECKS + 2; index += 1) {
      ids.push(await created(checks, { ok: true, check: (await controlledCheck()).check }))
    }
    // Every check but the last was replaced, so 21 have finished; the oldest is gone.
    expect(checks.status(ids[0] ?? '', 0)).toBeUndefined()
    expect(checks.status(ids[1] ?? '', 0)?.state).toBe('cancelled')
    expect(checks.status(ids.at(-1) ?? '', 0)?.state).toBe('prepared')
  })

  it('uses the ids it is given', async () => {
    const checks = store({ randomId: (length) => 'a'.repeat(length) })
    expect(await created(checks, { ok: true, check: await realCheck() })).toBe(
      'a'.repeat(CHECK_ID_LENGTH),
    )
  })

  it('on close, drops what is prepared, stops what runs, and takes nothing new', async () => {
    const checks = store()
    const run = await controlledCheck()
    const runId = await created(checks, { ok: true, check: run.check })
    checks.start(runId)
    checks.close()
    expect(run.started()?.signal?.aborted).toBe(true)
    run.settle({ state: 'cancelled', requests: 0, tokens: 0 })
    await flush()

    expect(await checks.create(ready({ ok: true, check: await realCheck() }))).toEqual({
      kind: 'busy',
    })

    const other = store()
    const idle = await controlledCheck()
    const idleId = await created(other, { ok: true, check: idle.check })
    other.close()
    expect(idle.discarded()).toBe(true)
    expect(other.start(idleId)).toBe('conflict')
  })

  it('discards a check whose preparation outlived the store', async () => {
    const checks = store()
    const late = await controlledCheck()
    let finish: (preparation: Preparation) => void = () => undefined
    const pending = checks.create(
      () =>
        new Promise<Preparation>((resolve) => {
          finish = resolve
        }),
    )
    checks.close()
    finish({ ok: true, check: late.check })
    expect(await pending).toEqual({ kind: 'busy' })
    expect(late.discarded()).toBe(true)
  })
})
