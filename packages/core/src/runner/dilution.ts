/**
 * Group F: one reading, repeated, one request at a time.
 *
 * The probe takes a reading; this decides how many, when, and which of them
 * count. A reading the endpoint failed to give is `lost` and re-run, up to a
 * ninth of the planned draws. A draw that travelled on a reused connection is
 * `excluded`, because two requests on one connection are not two independent
 * trips through a router. A transport that cannot say which connection a
 * request used cannot run this group at all. See `docs/scoring.md`.
 */

import type {
  DilutionPlan,
  DilutionProbe,
  ProbeContext,
  ProbeRequest,
  Signal,
} from '../probes/types.js'
import { DILUTION_BASES } from '../probes/types.js'
import type { ConnectionReuse } from '../transport/types.js'
import { BudgetExceeded, ProbeLost } from './errors.js'
import type { Session } from './session.js'
import type { DilutionRun, DrawRecord, DrawRecordOutcome, RunEvent, SkipReason } from './types.js'

export interface DilutionConfig {
  readonly draws: number
  readonly spreadMs: number
  readonly random: () => number
  readonly clock: () => number
}

export interface DilutionOutcome {
  readonly status: 'ran' | 'skipped'
  readonly reason?: SkipReason
  /** Kept when the budget cut the draws short, so the report can show them. */
  readonly dilution: DilutionRun | undefined
  /** What `conclude` made of the readings; only when every planned draw was taken. */
  readonly signals: readonly Signal[]
}

type Draw =
  | { readonly kind: 'reading'; readonly reading: string }
  | { readonly kind: 'lost' }
  | { readonly kind: 'excluded' }
  | { readonly kind: 'unobserved' }

interface Taken {
  readonly draw: number
  readonly result: Exclude<Draw, { readonly kind: 'unobserved' }>
}

/** The most frequent reading; a tie goes to the one seen first. */
export function modeOf(readings: readonly string[]): string | undefined {
  const counts = new Map<string, number>()
  for (const reading of readings) {
    counts.set(reading, (counts.get(reading) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = 0
  for (const [reading, count] of counts) {
    if (count > bestCount) {
      best = reading
      bestCount = count
    }
  }
  return best
}

/** `count` moments in [0, spreadMs), sorted, drawn fresh each run. */
export function spreadMoments(count: number, spreadMs: number, random: () => number): number[] {
  if (spreadMs <= 0) {
    return []
  }
  return Array.from({ length: count }, () => Math.floor(random() * spreadMs)).sort((a, b) => a - b)
}

/** Lost or excluded draws re-run at most this many times: a ninth of those planned. */
export function replacementAllowance(draws: number): number {
  return Math.floor(draws / 9)
}

function checkPlan(plan: DilutionPlan): DilutionPlan {
  if (!DILUTION_BASES.has(plan.basis)) {
    throw new TypeError(`Not a dilution basis: ${JSON.stringify(plan.basis)}`)
  }
  if (plan.basis === 'reference' && typeof plan.reference !== 'string') {
    throw new TypeError('A reference-basis plan must say what the claimed model reads')
  }
  return plan
}

async function takeDraw(
  probe: DilutionProbe,
  plan: DilutionPlan,
  session: Session,
  contextFor: (send: ProbeContext['send']) => ProbeContext,
  draw: number,
): Promise<Draw> {
  const send = (request: ProbeRequest) => session.send(request, { probeId: probe.id, draw })
  let reading: string | undefined
  let lost = false
  try {
    reading = await plan.read(contextFor(send))
  } catch (error) {
    if (!(error instanceof ProbeLost)) {
      throw error
    }
    lost = true
  }
  // The evidence log, not the exchanges: a request that failed has no exchange,
  // and its connection still decides whether the draw was independent.
  const seen: readonly ConnectionReuse[] = session
    .evidence()
    .filter((entry) => entry.probeId === probe.id && entry.draw === draw)
    .map((entry) => entry.connection)
  if (seen.length > probe.requestsPerDraw) {
    throw new TypeError(`${probe.id} sent more requests in one draw than it declares`)
  }
  if (!lost && seen.includes('unobserved')) {
    // An answer on a socket the transport cannot report on: no draw here is independent.
    return { kind: 'unobserved' }
  }
  if (seen.some((connection) => connection !== 'fresh')) {
    return { kind: 'excluded' }
  }
  return lost || reading === undefined ? { kind: 'lost' } : { kind: 'reading', reading }
}

/** Where the draws stand. Local to one run of the loop and never shared. */
interface Loop {
  readonly taken: Taken[]
  planned: number
  /** Replacements still to send. */
  owed: number
  replaced: number
  excluded: number
}

interface Draws {
  readonly probe: DilutionProbe
  readonly plan: DilutionPlan
  readonly session: Session
  readonly contextFor: (send: ProbeContext['send']) => ProbeContext
  readonly config: DilutionConfig
  readonly emit: (event: RunEvent) => void
  readonly allowance: number
  readonly moments: readonly number[]
  readonly startedMs: number
}

/** A replacement goes out at once; only a planned draw waits for its moment. */
async function awaitSlot(draws: Draws, loop: Loop): Promise<void> {
  if (loop.owed > 0) {
    loop.owed -= 1
    return
  }
  const moment = draws.moments[loop.planned]
  loop.planned += 1
  if (moment === undefined) {
    return
  }
  const waitMs = draws.startedMs + moment - draws.config.clock()
  if (waitMs > 0) {
    await draws.session.wait(draws.probe.id, Math.ceil(waitMs))
  }
}

/** Records one draw. `false` when the transport cannot keep the draws independent. */
function tally(draws: Draws, loop: Loop, result: Taken['result']): boolean {
  const draw = loop.taken.length + 1
  loop.taken.push({ draw, result })
  if (result.kind === 'reading') {
    // Against the run's own majority, no draw can be judged until all are in.
    if (draws.plan.basis === 'reference') {
      const agrees = result.reading === draws.plan.reference
      draws.emit({ kind: 'draw', draw, outcome: agrees ? 'agree' : 'disagree' })
    } else {
      draws.emit({ kind: 'draw-taken', draw })
    }
    return true
  }
  draws.emit({ kind: 'draw', draw, outcome: result.kind })
  if (result.kind === 'excluded') {
    loop.excluded += 1
    if (loop.excluded > draws.allowance) {
      return false
    }
  }
  if (loop.replaced < draws.allowance) {
    loop.replaced += 1
    loop.owed += 1
  }
  return true
}

async function drawAll(draws: Draws, loop: Loop): Promise<'done' | 'budget' | 'unsupported'> {
  while (loop.planned < draws.config.draws || loop.owed > 0) {
    await awaitSlot(draws, loop)
    let result: Draw
    try {
      result = await takeDraw(
        draws.probe,
        draws.plan,
        draws.session,
        draws.contextFor,
        loop.taken.length + 1,
      )
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        return 'budget'
      }
      throw error
    }
    if (result.kind === 'unobserved' || !tally(draws, loop, result)) {
      return 'unsupported'
    }
  }
  return 'done'
}

const NO_SIGNALS: readonly Signal[] = Object.freeze([])

export async function runDilution(
  probe: DilutionProbe,
  session: Session,
  contextFor: (send: ProbeContext['send']) => ProbeContext,
  config: DilutionConfig,
  emit: (event: RunEvent) => void,
): Promise<DilutionOutcome> {
  const plan = checkPlan(
    await probe.prepare(contextFor((request) => session.send(request, { probeId: probe.id }))),
  )
  const draws: Draws = {
    probe,
    plan,
    session,
    contextFor,
    config,
    emit,
    allowance: replacementAllowance(config.draws),
    moments: spreadMoments(config.draws, config.spreadMs, config.random),
    startedMs: config.clock(),
  }
  const loop: Loop = { taken: [], planned: 0, owed: 0, replaced: 0, excluded: 0 }
  const ended = await drawAll(draws, loop)
  if (ended === 'unsupported') {
    return Object.freeze({
      status: 'skipped',
      reason: 'unsupported-by-transport',
      dilution: undefined,
      signals: NO_SIGNALS,
    })
  }
  const dilution = runOf(probe, plan, loop.taken, config)
  if (plan.basis === 'mode') {
    for (const record of dilution.draws) {
      if (record.outcome === 'agree' || record.outcome === 'disagree') {
        emit({ kind: 'draw', draw: record.draw, outcome: record.outcome })
      }
    }
  }
  if (ended === 'budget') {
    return Object.freeze({
      status: 'skipped',
      reason: 'budget-exceeded',
      dilution,
      signals: NO_SIGNALS,
    })
  }
  return Object.freeze({ status: 'ran', dilution, signals: plan.conclude(dilution.readings) })
}

function runOf(
  probe: DilutionProbe,
  plan: DilutionPlan,
  taken: readonly Taken[],
  config: DilutionConfig,
): DilutionRun {
  const readings = taken.flatMap(({ result }) =>
    result.kind === 'reading' ? [result.reading] : [],
  )
  const expected = plan.basis === 'reference' ? plan.reference : modeOf(readings)
  const draws = taken.map(({ draw, result }): DrawRecord => {
    const outcome: DrawRecordOutcome =
      result.kind === 'reading'
        ? result.reading === expected
          ? 'agree'
          : 'disagree'
        : result.kind === 'excluded'
          ? 'excluded'
          : 'lost'
    return Object.freeze({ draw, outcome })
  })
  return Object.freeze({
    probeId: probe.id,
    basis: plan.basis,
    measures: plan.measures,
    requestsPerDraw: probe.requestsPerDraw,
    draws: Object.freeze(draws),
    readings: Object.freeze(readings),
    planned: config.draws,
    spreadMs: config.spreadMs,
  })
}
