/**
 * The daemon's checks, from an accepted estimate to a report or its absence.
 *
 * One check at a time: a run spends the buyer's money and has the endpoint's
 * rate limits to itself, and two at once would share both. A check that was
 * prepared and never started is replaced by the next one, and dropped - key
 * and all - after `PREPARED_TTL_MS`. Finished checks are kept for their
 * reports, a bounded few, and never on disk.
 *
 * Entries are replaced, never edited. The one exception is each check's event
 * log, which only ever grows and is copied out whenever it is read.
 */

import {
  type ApiError,
  type CheckEvent,
  type CheckOutcome,
  type CheckProgress,
  type CheckState,
  type CheckStatusResponse,
  type CreateCheckResponse,
  FINAL_CHECK_STATES,
  type Preparation,
  type PreparedCheck,
  type Report,
  type RunEvent,
  randomId,
} from '@verifai/core'

export const CHECK_ID_LENGTH = 24
export const PREPARED_TTL_MS = 10 * 60_000
export const MAX_FINISHED_CHECKS = 20
/** Far above what the largest budget produces; past it, progress still counts. */
export const MAX_STORED_EVENTS = 10_000
export const MAX_EVENTS_PER_RESPONSE = 500

const INTERNAL_ERROR: ApiError = Object.freeze({
  code: 'internal',
  message: 'The check failed inside VerifAI. Nothing was concluded about the endpoint.',
})

interface Entry {
  readonly checkId: string
  readonly state: CheckState
  readonly progress: CheckProgress
  readonly prepared?: PreparedCheck
  readonly controller?: AbortController
  readonly expiry?: ReturnType<typeof setTimeout>
  readonly report?: Report
  readonly error?: ApiError
}

export type CreateResult =
  | { readonly kind: 'created'; readonly response: CreateCheckResponse }
  | { readonly kind: 'busy' }
  | { readonly kind: 'refused'; readonly error: ApiError }

export type Transition = 'ok' | 'not-found' | 'conflict'

export type ReportLookup =
  | { readonly kind: 'ok'; readonly report: Report }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'conflict' }

export interface CheckStore {
  /** Runs `prepare` unless a check is running or being prepared. */
  readonly create: (prepare: () => Promise<Preparation>) => Promise<CreateResult>
  readonly start: (checkId: string) => Transition
  /** The state after asking; a running check reports `cancelled` once it has stopped. */
  readonly cancel: (checkId: string) => CheckState | undefined
  readonly status: (checkId: string, since: number) => CheckStatusResponse | undefined
  readonly report: (checkId: string) => ReportLookup
  /** Drops every prepared check and stops the running one. */
  readonly close: () => void
}

export interface StoreOptions {
  /** Wall-clock milliseconds, for the report's timestamps. */
  readonly now?: () => number
  readonly randomId?: (length: number) => string
  readonly preparedTtlMs?: number
  /** Given the redacted detail of a check VerifAI failed. */
  readonly onFailure?: (detail: string) => void
}

/** The error's name only: its message could quote what the check was holding, the key included. */
function describe(error: unknown): string {
  return `execute rejected: ${error instanceof Error ? error.name : 'non-error thrown'}`
}

function progressAfter(progress: CheckProgress, event: RunEvent): CheckProgress {
  if (event.kind === 'probe-finished') {
    return { ...progress, done: progress.done + 1 }
  }
  return event.kind === 'request'
    ? { ...progress, requests: progress.requests + 1, tokens: progress.tokens + event.tokens }
    : progress
}

export function createCheckStore(options: StoreOptions = {}): CheckStore {
  const draw = options.randomId ?? randomId
  const ttl = options.preparedTtlMs ?? PREPARED_TTL_MS
  const entries = new Map<string, Entry>()
  const logs = new Map<string, CheckEvent[]>()
  let preparing = false
  let closed = false

  const update = (checkId: string, change: (entry: Entry) => Entry) => {
    const entry = entries.get(checkId)
    if (entry !== undefined) {
      entries.set(checkId, Object.freeze(change(entry)))
    }
  }

  const isActive = () => [...entries.values()].some((entry) => entry.state === 'running')

  /** Ends a prepared check without running it. */
  const drop = (checkId: string) => {
    update(checkId, (entry) => {
      entry.prepared?.discard()
      clearTimeout(entry.expiry)
      const { prepared: _, expiry: __, ...rest } = entry
      return { ...rest, state: 'cancelled' }
    })
  }

  const prune = () => {
    const final = [...entries.values()].filter((entry) => FINAL_CHECK_STATES.has(entry.state))
    for (const entry of final.slice(0, Math.max(0, final.length - MAX_FINISHED_CHECKS))) {
      entries.delete(entry.checkId)
      logs.delete(entry.checkId)
    }
  }

  const record = (checkId: string, event: RunEvent) => {
    const log = logs.get(checkId)
    if (log !== undefined && log.length < MAX_STORED_EVENTS) {
      log.push(Object.freeze({ seq: log.length, event }))
    }
    update(checkId, (entry) => ({ ...entry, progress: progressAfter(entry.progress, event) }))
  }

  const settle = (checkId: string, outcome: CheckOutcome) => {
    update(checkId, (entry) => {
      const { controller: _, ...rest } = entry
      switch (outcome.state) {
        case 'finished':
        case 'cancelled': {
          const progress = { ...rest.progress, requests: outcome.requests, tokens: outcome.tokens }
          return outcome.state === 'finished'
            ? { ...rest, state: 'finished', progress, report: outcome.report }
            : { ...rest, state: 'cancelled', progress }
        }
        case 'stopped':
          return { ...rest, state: 'stopped', error: outcome.error }
        default:
          options.onFailure?.(outcome.detail)
          return { ...rest, state: 'failed', error: outcome.error }
      }
    })
    prune()
  }

  const run = async (checkId: string, check: PreparedCheck, controller: AbortController) => {
    let outcome: CheckOutcome
    try {
      outcome = await check.execute({
        signal: controller.signal,
        onEvent: (event) => record(checkId, event),
        ...(options.now === undefined ? {} : { now: options.now }),
      })
    } catch (error: unknown) {
      outcome = { state: 'failed', error: INTERNAL_ERROR, detail: describe(error) }
    }
    settle(checkId, outcome)
  }

  const admit = (preparation: Preparation): CreateResult => {
    if (!preparation.ok) {
      return { kind: 'refused', error: preparation.error }
    }
    const { check } = preparation
    // A check may have started, or the daemon closed, while this one was prepared.
    if (closed || isActive()) {
      check.discard()
      return { kind: 'busy' }
    }
    for (const entry of [...entries.values()]) {
      if (entry.state === 'prepared') {
        drop(entry.checkId)
      }
    }
    const checkId = draw(CHECK_ID_LENGTH)
    const expiry = setTimeout(() => drop(checkId), ttl)
    expiry.unref()
    entries.set(
      checkId,
      Object.freeze({
        checkId,
        state: 'prepared',
        progress: { done: 0, total: check.estimate.probes.length, requests: 0, tokens: 0 },
        prepared: check,
        expiry,
      }),
    )
    logs.set(checkId, [])
    prune()
    return { kind: 'created', response: { checkId, estimate: check.estimate } }
  }

  return Object.freeze({
    create: async (prepare: () => Promise<Preparation>): Promise<CreateResult> => {
      if (closed || preparing || isActive()) {
        return { kind: 'busy' }
      }
      preparing = true
      try {
        return admit(await prepare())
      } finally {
        preparing = false
      }
    },
    start: (checkId: string): Transition => {
      const entry = entries.get(checkId)
      if (entry === undefined) {
        return 'not-found'
      }
      const check = entry.prepared
      if (entry.state !== 'prepared' || check === undefined || closed) {
        return 'conflict'
      }
      clearTimeout(entry.expiry)
      const controller = new AbortController()
      const { prepared: _, expiry: __, ...rest } = entry
      entries.set(checkId, Object.freeze({ ...rest, state: 'running', controller }))
      void run(checkId, check, controller)
      return 'ok'
    },
    cancel: (checkId: string) => {
      const entry = entries.get(checkId)
      if (entry?.state === 'prepared') {
        drop(checkId)
      } else if (entry?.state === 'running') {
        entry.controller?.abort()
      }
      return entries.get(checkId)?.state
    },
    status: (checkId: string, since: number) => {
      const entry = entries.get(checkId)
      if (entry === undefined) {
        return undefined
      }
      const log = logs.get(checkId) ?? []
      const from = Math.min(since, log.length)
      const events = log.slice(from, from + MAX_EVENTS_PER_RESPONSE)
      return Object.freeze({
        checkId,
        state: entry.state,
        progress: entry.progress,
        events: Object.freeze(events),
        nextEvent: from + events.length,
        ...(entry.report === undefined ? {} : { report: entry.report }),
        ...(entry.error === undefined ? {} : { error: entry.error }),
      })
    },
    report: (checkId: string): ReportLookup => {
      const entry = entries.get(checkId)
      if (entry === undefined) {
        return { kind: 'not-found' }
      }
      return entry.report === undefined
        ? { kind: 'conflict' }
        : { kind: 'ok', report: entry.report }
    },
    close: () => {
      closed = true
      for (const entry of [...entries.values()]) {
        if (entry.state === 'prepared') {
          drop(entry.checkId)
        } else if (entry.state === 'running') {
          entry.controller?.abort()
        }
      }
    },
  })
}
