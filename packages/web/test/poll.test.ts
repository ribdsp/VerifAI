import type { CheckStatusResponse, Report } from '@verifai/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '../src/lib/api'
import {
  applyStatus,
  initialRunState,
  isFinal,
  MAX_LOG_EVENTS,
  MAX_TRANSIENT_FAILURES,
  pollCheck,
  type RunState,
  sleep,
} from '../src/lib/poll'
import { CREATED, checkEvent, REPORT, statusOf } from './fixtures'

const CHECK_ID = CREATED.checkId

function drawEvent(seq: number, draw: number, outcome: 'agree' | 'disagree' | 'lost') {
  return checkEvent(seq, { kind: 'draw', draw, outcome })
}

function requestEvent(seq: number) {
  return checkEvent(seq, { kind: 'request', probeId: 'A1', status: 200 })
}

/** A client that answers each status call with the next item, throwing any error. */
function scriptedClient(script: readonly (CheckStatusResponse | Error)[], report = REPORT) {
  const sinces: number[] = []
  let index = 0
  const client = {
    status: vi.fn(async (_checkId: string, since: number) => {
      sinces.push(since)
      const next = script[Math.min(index, script.length - 1)]
      index += 1
      if (next === undefined || next instanceof Error) {
        throw next ?? new Error('script ran out')
      }
      return next
    }),
    report: vi.fn(async (): Promise<Report> => report),
  }
  return { client, sinces }
}

const noWait = vi.fn(async () => {})

afterEach(() => {
  noWait.mockClear()
  vi.useRealTimers()
})

describe('applyStatus', () => {
  it('appends new events in order and moves nextEvent on', () => {
    const state = applyStatus(
      initialRunState(CHECK_ID, 2),
      statusOf({ events: [requestEvent(1), requestEvent(0)], nextEvent: 2 }),
    )

    expect(state.log.map((entry) => entry.seq)).toEqual([0, 1])
    expect(state.lastSeq).toBe(1)
    expect(state.nextEvent).toBe(2)
  })

  it('skips events it has already applied', () => {
    const once = applyStatus(
      initialRunState(CHECK_ID),
      statusOf({ events: [requestEvent(0), requestEvent(1)], nextEvent: 2 }),
    )

    const twice = applyStatus(
      once,
      statusOf({ events: [requestEvent(1), requestEvent(2)], nextEvent: 3 }),
    )

    expect(twice.log.map((entry) => entry.seq)).toEqual([0, 1, 2])
  })

  it('never moves nextEvent backwards', () => {
    const ahead = { ...initialRunState(CHECK_ID), nextEvent: 9 }

    expect(applyStatus(ahead, statusOf({ nextEvent: 4 })).nextEvent).toBe(9)
  })

  it('keeps every draw, by draw number, in order', () => {
    const first = applyStatus(
      initialRunState(CHECK_ID),
      statusOf({ events: [drawEvent(0, 2, 'disagree'), drawEvent(1, 1, 'agree')] }),
    )

    const second = applyStatus(first, statusOf({ events: [drawEvent(2, 2, 'lost')] }))

    expect(second.draws).toEqual([
      { draw: 1, outcome: 'agree' },
      { draw: 2, outcome: 'lost' },
    ])
  })

  it('keeps only the most recent events in the log', () => {
    const events = Array.from({ length: MAX_LOG_EVENTS + 5 }, (_, seq) => requestEvent(seq))

    const state = applyStatus(initialRunState(CHECK_ID), statusOf({ events }))

    expect(state.log).toHaveLength(MAX_LOG_EVENTS)
    expect(state.log[0]?.seq).toBe(5)
  })

  it('ignores a status for another check', () => {
    const current = initialRunState(CHECK_ID)

    expect(applyStatus(current, statusOf({ checkId: 'other', state: 'failed' }))).toBe(current)
  })

  it('never leaves a final state', () => {
    const cancelled: RunState = { ...initialRunState(CHECK_ID), state: 'cancelled' }

    expect(applyStatus(cancelled, statusOf({ state: 'running' }))).toBe(cancelled)
    expect(isFinal('cancelled')).toBe(true)
    expect(isFinal('running')).toBe(false)
  })

  it('keeps a report and an error once it has them', () => {
    const error = { code: 'unreachable', message: 'Gone.' } as const
    const withBoth = applyStatus(initialRunState(CHECK_ID), statusOf({ report: REPORT, error }))

    const later = applyStatus(withBoth, statusOf())

    expect(later.report).toBe(REPORT)
    expect(later.error).toEqual(error)
  })
})

describe('pollCheck', () => {
  it('polls since nextEvent until final, then fetches the report', async () => {
    const { client, sinces } = scriptedClient([
      statusOf({ events: [requestEvent(0)], nextEvent: 1 }),
      statusOf({ state: 'finished', events: [requestEvent(1)], nextEvent: 2 }),
    ])
    const updates: RunState[] = []

    const final = await pollCheck(client, initialRunState(CHECK_ID), {
      signal: new AbortController().signal,
      onUpdate: (state) => updates.push(state),
      sleep: noWait,
      intervalMs: 25,
    })

    expect(sinces).toEqual([0, 1])
    expect(noWait).toHaveBeenCalledExactlyOnceWith(25, expect.any(AbortSignal))
    expect(client.report).toHaveBeenCalledOnce()
    expect(final.state).toBe('finished')
    expect(final.report).toBe(REPORT)
    expect(updates.at(-1)).toBe(final)
  })

  it('uses the report the final status carried', async () => {
    const { client } = scriptedClient([statusOf({ state: 'finished', report: REPORT })])

    const final = await pollCheck(client, initialRunState(CHECK_ID), {
      signal: new AbortController().signal,
      onUpdate: () => {},
      sleep: noWait,
    })

    expect(final.report).toBe(REPORT)
    expect(client.report).not.toHaveBeenCalled()
  })

  it('stops on a state without a report and asks for none', async () => {
    const error = { code: 'invalid-key', message: 'The endpoint refused the key.' } as const
    const { client } = scriptedClient([statusOf({ state: 'stopped', error })])

    const final = await pollCheck(client, initialRunState(CHECK_ID), {
      signal: new AbortController().signal,
      onUpdate: () => {},
      sleep: noWait,
    })

    expect(final).toMatchObject({ state: 'stopped', error, report: undefined })
    expect(client.report).not.toHaveBeenCalled()
  })

  it('rides out a few transient failures', async () => {
    const { client } = scriptedClient([
      new ApiClientError('network', 'down'),
      new ApiClientError('busy', 'busy', 503),
      statusOf({ state: 'cancelled' }),
    ])

    const final = await pollCheck(client, initialRunState(CHECK_ID), {
      signal: new AbortController().signal,
      onUpdate: () => {},
      sleep: noWait,
    })

    expect(final.state).toBe('cancelled')
    expect(client.status).toHaveBeenCalledTimes(3)
  })

  it('gives up after too many transient failures in a row', async () => {
    const { client } = scriptedClient([new ApiClientError('network', 'down')])

    await expect(
      pollCheck(client, initialRunState(CHECK_ID), {
        signal: new AbortController().signal,
        onUpdate: () => {},
        sleep: noWait,
      }),
    ).rejects.toMatchObject({ code: 'network' })
    expect(client.status).toHaveBeenCalledTimes(MAX_TRANSIENT_FAILURES + 1)
  })

  it('fails at once on an error that is not transient', async () => {
    const { client } = scriptedClient([new ApiClientError('not-found', 'No such check.', 404)])

    await expect(
      pollCheck(client, initialRunState(CHECK_ID), {
        signal: new AbortController().signal,
        onUpdate: () => {},
        sleep: noWait,
      }),
    ).rejects.toMatchObject({ code: 'not-found' })
    expect(client.status).toHaveBeenCalledOnce()
  })

  it('returns the state it has when aborted, without throwing', async () => {
    const controller = new AbortController()
    const { client } = scriptedClient([statusOf({ events: [requestEvent(0)], nextEvent: 1 })])
    client.status.mockImplementationOnce(async () => {
      controller.abort()
      throw new ApiClientError('aborted', 'cancelled')
    })
    const initial = initialRunState(CHECK_ID)

    await expect(
      pollCheck(client, initial, { signal: controller.signal, onUpdate: () => {}, sleep: noWait }),
    ).resolves.toBe(initial)
  })

  it('does not call at all once already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { client } = scriptedClient([statusOf()])

    await pollCheck(client, initialRunState(CHECK_ID), {
      signal: controller.signal,
      onUpdate: () => {},
      sleep: noWait,
    })

    expect(client.status).not.toHaveBeenCalled()
  })
})

describe('sleep', () => {
  it('resolves after the interval', async () => {
    vi.useFakeTimers()
    let isDone = false
    const pending = sleep(500, new AbortController().signal).then(() => {
      isDone = true
    })

    await vi.advanceTimersByTimeAsync(499)
    expect(isDone).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await pending

    expect(isDone).toBe(true)
  })

  it('resolves as soon as the signal aborts', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const pending = sleep(60_000, controller.signal)

    controller.abort()

    await expect(pending).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })
})
