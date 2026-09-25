/**
 * The most confidence a run may claim, given what actually ran:
 * `docs/scoring.md#coverage-ceiling`.
 *
 * Groups B, C and D set the level, because they are the evidence a proxy
 * cannot fake by copying error strings. Three things lower it from there: a
 * cross-protocol pairing, which erases vendor-specific signals by
 * construction; probes that should have run and did not; and a run in which no
 * signal rests on recorded ground truth.
 */

import type { ProbeGroup, Signal } from '../probes/types.js'
import type { CeilingReason } from '../report/types.js'
import { GAP_REASONS, type ProbeOutcome, SKIP_REASONS } from '../runner/types.js'
import type { Pairing } from '../types/target.js'
import { subset } from '../types/vocabulary.js'

/** B, C and D all ran. The most any run may claim: never certainty. */
export const FULL_COVERAGE_CEILING = 0.98
/** B and C ran, D did not. */
export const NO_CAUSAL_CEILING = 0.88
/** One of B and C ran. */
export const ONE_OF_B_C_CEILING = 0.75
/** Neither ran: conformance alone, which catches naive proxies and clears nobody. */
export const CONFORMANCE_ONLY_CEILING = 0.6

export const CROSS_PROTOCOL_REDUCTION = 0.04
/** Taken off per unit of gap share: a run missing a tenth of its probes loses 0.02. */
export const GAP_REDUCTION = 0.2
export const DOCUMENTED_ONLY_REDUCTION = 0.02

/** Skips that say a probe had nothing to measure here, or was never asked to. */
const NOT_EVIDENCE = subset(SKIP_REASONS, ['not-applicable', 'profile', 'opt-in'])

/** Ceilings are sums of short decimals; this keeps 0.9 from reading as 0.8999999. */
const PRECISION = 1e9

export interface Ceiling {
  readonly value: number
  readonly reasons: readonly CeilingReason[]
}

function checkOutcome(outcome: ProbeOutcome): void {
  if (outcome.status === 'skipped' && !SKIP_REASONS.has(outcome.reason)) {
    throw new TypeError(`${outcome.probeId}: a skipped probe must say why`)
  }
}

/** The outcomes that were ever evidence: every probe that ran or should have. */
export function applicableOutcomes(outcomes: readonly ProbeOutcome[]): readonly ProbeOutcome[] {
  for (const outcome of outcomes) {
    checkOutcome(outcome)
  }
  return outcomes.filter((outcome) => outcome.status === 'ran' || !NOT_EVIDENCE.has(outcome.reason))
}

/** A group counts when at least half of its applicable probes finished. */
export function groupRan(outcomes: readonly ProbeOutcome[], group: ProbeGroup): boolean {
  const applicable = applicableOutcomes(outcomes).filter((outcome) => outcome.group === group)
  const ran = applicable.filter((outcome) => outcome.status === 'ran').length
  return applicable.length > 0 && ran * 2 >= applicable.length
}

/** The share of applicable probes that left a hole in the evidence. */
export function gapShare(outcomes: readonly ProbeOutcome[]): number {
  const applicable = applicableOutcomes(outcomes)
  const gaps = applicable.filter((outcome) => GAP_REASONS.has(outcome.reason)).length
  return applicable.length === 0 ? 0 : gaps / applicable.length
}

function coverage(outcomes: readonly ProbeOutcome[]): Ceiling {
  const b = groupRan(outcomes, 'B')
  const c = groupRan(outcomes, 'C')
  const d = groupRan(outcomes, 'D')
  const reasons: CeilingReason[] = []
  let value = FULL_COVERAGE_CEILING
  if (!(b || c)) {
    reasons.push('groups-b-c-not-run')
    value = CONFORMANCE_ONLY_CEILING
  } else if (!(b && c)) {
    reasons.push(b ? 'group-c-not-run' : 'group-b-not-run')
    value = ONE_OF_B_C_CEILING
  }
  if (!d) {
    reasons.push('group-d-not-run')
    value = Math.min(value, NO_CAUSAL_CEILING)
  }
  return { value, reasons }
}

export function ceilingFor(
  outcomes: readonly ProbeOutcome[],
  signals: readonly Signal[],
  pairing: Pairing,
): Ceiling {
  const covered = coverage(outcomes)
  const crossProtocol = pairing === 'cross-protocol'
  const gaps = gapShare(outcomes)
  const documentedOnly = !signals.some((signal) => signal.calibration === 'measured')
  const reasons: readonly CeilingReason[] = [
    ...covered.reasons,
    ...(crossProtocol ? (['cross-protocol'] as const) : []),
    ...(gaps > 0 ? (['probes-skipped'] as const) : []),
    ...(documentedOnly ? (['calibration-documented-only'] as const) : []),
  ]
  const value =
    covered.value -
    (crossProtocol ? CROSS_PROTOCOL_REDUCTION : 0) -
    GAP_REDUCTION * gaps -
    (documentedOnly ? DOCUMENTED_ONLY_REDUCTION : 0)
  return Object.freeze({
    value: Math.max(0, Math.round(value * PRECISION) / PRECISION),
    reasons: Object.freeze(reasons),
  })
}
