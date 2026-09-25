/**
 * A running check as the page sees it, and the loop that keeps it current.
 *
 * `applyStatus` is a pure reducer over `CheckStatusResponse`s: it appends only
 * events it has not seen, keeps every Group F draw for the strip, and never
 * moves a check out of a final state. `pollCheck` asks for `?since=nextEvent`
 * every `POLL_INTERVAL_MS` until the check is final or the caller aborts.
 */

import {
  type ApiError,
  type CheckEvent,
  type CheckProgress,
  type CheckState,
  type CheckStatusResponse,
  type DrawRecord,
  FINAL_CHECK_STATES,
  POLL_INTERVAL_MS,
  type Report,
} from '@verifai/core'
import { type ApiClient, ApiClientError } from './api'

/** The log shows the most recent events; the draws are kept in full. */
export const MAX_LOG_EVENTS = 400

/** Consecutive transient failures tolerated before the poller gives up. */
export const MAX_TRANSIENT_FAILURES = 5

export interface RunState {
  readonly checkId: string
  readonly state: CheckState
  readonly progress: CheckProgress
  /** The most recent events, oldest first. */
  readonly log: readonly CheckEvent[]
  /** The highest `seq` applied, `-1` before any. */
  readonly lastSeq: number
  readonly nextEvent: number
  readonly draws: readonly DrawRecord[]
  /** The last draw taken, judged or not: a majority-basis run judges none until all are in. */
  readonly drawsTaken: number
  readonly report: Report | undefined
  readonly error: ApiError | undefined
}

export function initialRunState(checkId: string, total = 0): RunState {
  return {
    checkId,
    state: 'running',
    progress: { done: 0, total, requests: 0, tokens: 0 },
    log: [],
    lastSeq: -1,
    nextEvent: 0,
    draws: [],
    drawsTaken: 0,
    report: undefined,
    error: undefined,
  }
}

export function isFinal(state: CheckState): boolean {
  return FINAL_CHECK_STATES.has(state)
}

function mergeDraws(
  draws: readonly DrawRecord[],
  fresh: readonly CheckEvent[],
): readonly DrawRecord[] {
  const byDraw = new Map(draws.map((record) => [record.draw, record]))
  for (const { event } of fresh) {
    if (event.kind === 'draw') {
      byDraw.set(event.draw, { draw: event.draw, outcome: event.outcome })
    }
  }
  return [...byDraw.values()].sort((a, b) => a.draw - b.draw)
}

function lastTaken(taken: number, fresh: readonly CheckEvent[]): number {
  return fresh.reduce(
    (last, { event }) =>
      event.kind === 'draw' || event.kind === 'draw-taken' ? Math.max(last, event.draw) : last,
    taken,
  )
}

export function applyStatus(current: RunState, status: CheckStatusResponse): RunState {
  if (status.checkId !== current.checkId || isFinal(current.state)) {
    return current
  }
  const fresh = status.events
    .filter((entry) => entry.seq > current.lastSeq)
    .sort((a, b) => a.seq - b.seq)
  const lastSeq = fresh.at(-1)?.seq ?? current.lastSeq
  return {
    ...current,
    state: status.state,
    progress: status.progress,
    log: [...current.log, ...fresh].slice(-MAX_LOG_EVENTS),
    lastSeq,
    nextEvent: Math.max(current.nextEvent, status.nextEvent, lastSeq + 1),
    draws: fresh.length === 0 ? current.draws : mergeDraws(current.draws, fresh),
    drawsTaken: lastTaken(current.drawsTaken, fresh),
    report: status.report ?? current.report,
    error: status.error ?? current.error,
  }
}

export function withReport(current: RunState, report: Report): RunState {
  return { ...current, report }
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>

/** Resolves after `ms`, or as soon as `signal` aborts. Never rejects. */
export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })

export interface PollOptions {
  readonly signal: AbortSignal
  readonly onUpdate: (state: RunState) => void
  readonly intervalMs?: number
  readonly sleep?: Sleep
}

const TRANSIENT: ReadonlySet<string> = new Set(['network', 'busy', 'rate-limited'])

function isTransient(error: unknown): boolean {
  return error instanceof ApiClientError && TRANSIENT.has(error.code)
}

/**
 * Polls until the check is final, then fetches the report if the final
 * status did not carry one. Resolves with the last state, including when
 * aborted; rejects with the `ApiClientError` that stopped it otherwise.
 */
export async function pollCheck(
  client: Pick<ApiClient, 'status' | 'report'>,
  initial: RunState,
  options: PollOptions,
): Promise<RunState> {
  const { signal, onUpdate } = options
  const wait = options.sleep ?? sleep
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
  let state = initial
  let failures = 0
  while (!signal.aborted) {
    try {
      state = applyStatus(state, await client.status(state.checkId, state.nextEvent, signal))
      failures = 0
      onUpdate(state)
      if (isFinal(state.state)) {
        return await finish(client, state, options)
      }
    } catch (error) {
      if (signal.aborted) {
        return state
      }
      failures += 1
      if (!isTransient(error) || failures > MAX_TRANSIENT_FAILURES) {
        throw error
      }
    }
    await wait(intervalMs, signal)
  }
  return state
}

async function finish(
  client: Pick<ApiClient, 'report'>,
  state: RunState,
  { signal, onUpdate }: PollOptions,
): Promise<RunState> {
  if (state.state !== 'finished' || state.report !== undefined) {
    return state
  }
  const done = withReport(state, await client.report(state.checkId, signal))
  onUpdate(done)
  return done
}
