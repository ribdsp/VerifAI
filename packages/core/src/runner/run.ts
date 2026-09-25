/**
 * Runs a planned list of probes against one endpoint, one request at a time.
 *
 * The order is the planner's: this neither sorts nor shuffles. What a probe
 * returns is checked again here, because a signal that slipped past `signal()`
 * would reach the aggregator as a number that looks like evidence. Every way a
 * probe can end short of its signals becomes a `skipped` entry with a reason;
 * only a stopped run - wrong key, wrong model, nothing reached - ends it all.
 */

import { createRedactor } from '../credentials/redact.js'
import { DEFAULT_DRAWS } from '../planner/profiles.js'
import { signal as checkSignal } from '../probes/shared.js'
import {
  type AnyProbe,
  isDilutionProbe,
  type ProbeContext,
  type ProbeTarget,
  type Signal,
} from '../probes/types.js'
import type { Transport } from '../transport/types.js'
import { runDilution } from './dilution.js'
import {
  BudgetExceeded,
  ProbeLost,
  ProbeNotApplicable,
  RunAborted,
  RunStopped,
  TargetBlocked,
} from './errors.js'
import { createSession, DEFAULT_ENVIRONMENT, type RunEnvironment } from './session.js'
import type {
  DilutionRun,
  ProbeOutcome,
  RunEvent,
  RunResult,
  SkippedProbe,
  SkipReason,
} from './types.js'

export interface RunOptions {
  readonly target: ProbeTarget
  readonly transport: Transport
  /** Already normalised. */
  readonly apiKey?: string
  /** In the order to run them. */
  readonly probes: readonly AnyProbe[]
  readonly maxRequests: number
  readonly maxTokens: number
  readonly nonce: string
  /** Group F repetitions. */
  readonly draws?: number
  /** Spreads the Group F draws over this long. */
  readonly spreadMs?: number
  readonly signal?: AbortSignal
  readonly onEvent?: (event: RunEvent) => void
  readonly environment?: Partial<RunEnvironment>
}

const NONCE = /^[a-z0-9]{8,64}$/

/** Longest probe-error message kept. It names a bug; the stack is not for the report. */
export const MAX_PROBE_ERROR_MESSAGE = 300

interface Ended {
  readonly status: 'ran' | 'skipped'
  readonly reason?: SkipReason
  readonly signals: readonly Signal[]
}

function isBudget(value: number, allowZero: boolean): boolean {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
}

function checkOptions(options: RunOptions): void {
  if (!NONCE.test(options.nonce)) {
    throw new TypeError('A run nonce is 8 to 64 characters of [a-z0-9]')
  }
  if (!isBudget(options.maxRequests, true) || !isBudget(options.maxTokens, true)) {
    throw new TypeError('A run budget is a non-negative integer')
  }
  if (options.draws !== undefined && !isBudget(options.draws, false)) {
    throw new TypeError('Group F takes at least one draw')
  }
  if (options.spreadMs !== undefined && !isBudget(options.spreadMs, true)) {
    throw new TypeError('A spread is a non-negative number of milliseconds')
  }
  const ids = new Set(options.probes.map((probe) => probe.id))
  if (ids.size !== options.probes.length) {
    throw new TypeError('A run lists the same probe twice')
  }
  if (options.probes.filter(isDilutionProbe).length > 1) {
    throw new TypeError('A run takes at most one Group F probe')
  }
}

/** Re-checks what a probe returned; any fault is the probe's, never the endpoint's. */
function checkSignals(probeId: string, returned: unknown): readonly Signal[] {
  if (!Array.isArray(returned)) {
    throw new TypeError(`${probeId} did not return a list of signals`)
  }
  const seen = new Set<string>()
  const signals = returned.map((entry: Signal) => {
    if (!Object.isFrozen(entry) || entry.probeId !== probeId) {
      throw new TypeError(`${probeId} returned a signal not built with signal() for itself`)
    }
    if (seen.has(entry.signalId)) {
      throw new TypeError(`${probeId} returned signal ${entry.signalId} twice`)
    }
    seen.add(entry.signalId)
    return checkSignal(entry)
  })
  return Object.freeze(signals)
}

function describe(error: unknown, redact: (text: string) => string): string {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : 'A non-error was thrown'
  const redacted = redact(message)
  return redacted.length > MAX_PROBE_ERROR_MESSAGE
    ? `${redacted.slice(0, MAX_PROBE_ERROR_MESSAGE - 1)}…`
    : redacted
}

/** How a probe that threw is recorded. A stop goes on up; everything else is a skip. */
function skipReasonFor(error: unknown, aborted: boolean): SkipReason {
  if (error instanceof RunStopped) {
    throw error
  }
  if (error instanceof RunAborted || aborted) {
    return 'aborted'
  }
  if (error instanceof ProbeNotApplicable) {
    return 'not-applicable'
  }
  if (error instanceof ProbeLost) {
    return 'endpoint-error'
  }
  if (error instanceof BudgetExceeded) {
    return 'budget-exceeded'
  }
  if (error instanceof TargetBlocked) {
    return 'blocked'
  }
  return 'probe-error'
}

function sharedCache(): ProbeContext['shared'] {
  const cache = new Map<string, Promise<unknown>>()
  return <T>(key: string, compute: () => Promise<T>): Promise<T> => {
    const cached = cache.get(key)
    if (cached !== undefined) {
      return cached as Promise<T>
    }
    const pending = compute()
    cache.set(key, pending)
    // A failed computation is not kept: the next probe gets its own attempt.
    pending.catch(() => cache.delete(key))
    return pending
  }
}

export async function runProbes(options: RunOptions): Promise<RunResult> {
  checkOptions(options)
  const environment: RunEnvironment = { ...DEFAULT_ENVIRONMENT, ...options.environment }
  const signal = options.signal ?? new AbortController().signal
  const emit = (event: RunEvent) => options.onEvent?.(Object.freeze(event))
  const redact = createRedactor(options.apiKey === undefined ? [] : [options.apiKey])
  const session = createSession({
    target: options.target,
    transport: options.transport,
    apiKey: options.apiKey,
    maxRequests: options.maxRequests,
    maxTokens: options.maxTokens,
    signal,
    environment,
    emit,
  })
  const shared = sharedCache()
  const contextFor = (send: ProbeContext['send']): ProbeContext =>
    Object.freeze({
      target: options.target,
      hasKey: options.apiKey !== undefined,
      nonce: options.nonce,
      send,
      shared,
      signal,
    })

  const signals: Signal[] = []
  const skipped: SkippedProbe[] = []
  const outcomes: ProbeOutcome[] = []
  let dilution: DilutionRun | undefined
  let aborted = false

  const runOne = async (probe: AnyProbe): Promise<Ended> => {
    if (isDilutionProbe(probe)) {
      const outcome = await runDilution(
        probe,
        session,
        contextFor,
        {
          draws: options.draws ?? DEFAULT_DRAWS,
          spreadMs: options.spreadMs ?? 0,
          random: environment.random,
          clock: environment.clock,
        },
        emit,
      )
      dilution = outcome.dilution
      return {
        status: outcome.status,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        signals: checkSignals(probe.id, outcome.signals),
      }
    }
    const returned = await probe.run(
      contextFor((request) => session.send(request, { probeId: probe.id })),
    )
    return { status: 'ran', signals: checkSignals(probe.id, returned) }
  }

  const settle = (probe: AnyProbe, ended: Ended) => {
    signals.push(...ended.signals)
    if (ended.reason !== undefined) {
      skipped.push(Object.freeze({ probeId: probe.id, reason: ended.reason }))
    }
    outcomes.push(
      Object.freeze({
        probeId: probe.id,
        group: probe.group,
        status: ended.status,
        ...(ended.reason === undefined ? {} : { reason: ended.reason }),
      }),
    )
    emit({
      kind: 'probe-finished',
      probeId: probe.id,
      status: ended.status,
      ...(ended.reason === undefined ? {} : { reason: ended.reason }),
      signals: ended.signals.length,
    })
  }

  for (const [index, probe] of options.probes.entries()) {
    if (aborted || signal.aborted) {
      aborted = true
      settle(probe, { status: 'skipped', reason: 'aborted', signals: [] })
      continue
    }
    emit({ kind: 'probe-started', probeId: probe.id, index, total: options.probes.length })
    let ended: Ended
    try {
      ended = await runOne(probe)
    } catch (error) {
      const reason = skipReasonFor(error, signal.aborted)
      if (reason === 'probe-error') {
        emit({ kind: 'probe-error', probeId: probe.id, message: describe(error, redact) })
      }
      aborted ||= reason === 'aborted'
      ended = { status: 'skipped', reason, signals: [] }
    }
    settle(probe, ended)
  }

  if (session.requests() > 0 && !session.reached() && !aborted) {
    throw new RunStopped('unreachable')
  }

  return Object.freeze({
    signals: Object.freeze(signals),
    skipped: Object.freeze(skipped),
    evidence: session.evidence(),
    outcomes: Object.freeze(outcomes),
    dilution,
    aborted,
    requests: session.requests(),
    tokens: session.tokens(),
  })
}
