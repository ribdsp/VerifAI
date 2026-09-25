/**
 * Signals into posteriors, as `docs/scoring.md#signals` lays out.
 *
 * Log-odds add, but only inside four limits, because correlated evidence added
 * without limits is confident nonsense. Every signal is capped by how its
 * likelihood ratio was calibrated. The heuristic ones in a family are capped
 * together. Each family is capped as a whole, since twenty error strings from
 * one validator are closer to one fact than to twenty. And a veto, which is an
 * argument rather than a rate, overrides the sum.
 *
 * `consistency` is not here: only the dispersion test speaks to it, in
 * `dispersion.ts`. `evidence` is the runner's own account, in `assess.ts`.
 */

import type { Calibration, LlrTable, Signal, SignalFamily } from '../probes/types.js'
import { CALIBRATIONS, SIGNAL_FAMILIES } from '../probes/types.js'
import {
  IDENTITY_FINDINGS,
  type IdentityFinding,
  PLATFORM_FINDINGS,
  type PlatformFinding,
  TRANSLATION_FINDINGS,
  type TranslationFinding,
} from '../types/assessment.js'
import type { Pairing } from '../types/target.js'
import type { Vocabulary } from '../types/vocabulary.js'

/** The most one signal may move one finding, by how its ratio was calibrated. */
export const TIER_CAPS: Readonly<Record<Calibration, number>> = Object.freeze({
  measured: 2,
  documented: 1,
  derived: 0.7,
  heuristic: 0.3,
})

/** The most every heuristic signal in one family may move one finding, together. */
export const HEURISTIC_FAMILY_CAP = 0.3

/** The most one family may move one finding. Causal evidence is worth the most. */
export const FAMILY_CAPS: Readonly<Record<SignalFamily, number>> = Object.freeze({
  'protocol-conformance': 1.5,
  accounting: 1.5,
  tokenizer: 2,
  'causal-capability': 3,
  behavioral: 0.7,
})

/**
 * Where a vetoed finding is held: a million to one against, whatever else was
 * seen. More than every family cap together can undo.
 */
export const VETO_LLR = -6

/** Where the priors put an unresolved reading: ahead of any single concrete finding. */
export const IDENTITY_PRIOR: Readonly<Record<IdentityFinding, number>> = Object.freeze({
  'matches-claim': 0.175,
  'same-vendor-cheaper': 0.175,
  'different-vendor': 0.175,
  'not-a-live-model': 0.175,
  unknown: 0.3,
})

export const PLATFORM_PRIOR: Readonly<Record<PlatformFinding, number>> = Object.freeze({
  'first-party': 0.35,
  'partner-cloud': 0.35,
  unknown: 0.3,
})

export const TRANSLATION_PRIOR: Readonly<Record<TranslationFinding, number>> = Object.freeze({
  direct: 0.35,
  translated: 0.35,
  unknown: 0.3,
})

/** Two posteriors closer than this are a tie, and a tie is not a finding. */
const TIE = 1e-9

type Axis = keyof LlrTable

export interface AxisReadings<I, P, T> {
  readonly identity: I
  readonly platform: P
  readonly translation: T
}

export type Llrs = AxisReadings<
  Readonly<Record<IdentityFinding, number>>,
  Readonly<Record<PlatformFinding, number>>,
  Readonly<Record<TranslationFinding, number>>
>

export interface Aggregate {
  /** The capped sums, after vetoes: what the posteriors were computed from. */
  readonly llr: Llrs
  readonly posteriors: Llrs
}

const AXES: Readonly<Record<Axis, Vocabulary<string>>> = Object.freeze({
  identity: IDENTITY_FINDINGS,
  platform: PLATFORM_FINDINGS,
  translation: TRANSLATION_FINDINGS,
})

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value))
}

function tableOf(signal: Signal, axis: Axis): Readonly<Record<string, number | undefined>> {
  return signal.llr[axis] ?? {}
}

/**
 * A signal the aggregator cannot read exactly is a construction error. Scoring
 * it as zero would hide the bug inside a posterior, and a family that is not on
 * the list - self-report, style - has no path into the sum at all.
 */
function checkSignal(signal: Signal): void {
  const where = `${signal.probeId}/${signal.signalId}`
  if (!SIGNAL_FAMILIES.has(signal.family)) {
    throw new TypeError(`${where}: not a signal family: ${JSON.stringify(signal.family)}`)
  }
  // The type says non-empty; a signal built from parsed JSON has only this to say it.
  if (!Array.isArray(signal.citations) || signal.citations.length === 0) {
    throw new TypeError(`${where}: a signal must cite the source of what it expected`)
  }
  if (!CALIBRATIONS.has(signal.calibration)) {
    throw new TypeError(`${where}: not a calibration: ${JSON.stringify(signal.calibration)}`)
  }
  checkRatios(signal, where)
  for (const finding of signal.vetoes ?? []) {
    if (!IDENTITY_FINDINGS.has(finding)) {
      throw new TypeError(`${where}: cannot veto ${JSON.stringify(finding)}`)
    }
  }
}

function checkRatios(signal: Signal, where: string): void {
  for (const axis of Object.keys(signal.llr)) {
    const findings = AXES[axis as Axis]
    if (findings === undefined) {
      throw new TypeError(`${where}: no ratios on ${JSON.stringify(axis)}`)
    }
    for (const [finding, value] of Object.entries(tableOf(signal, axis as Axis))) {
      if (!findings.has(finding) || typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${where}: not a finite ratio for ${axis} ${JSON.stringify(finding)}`)
      }
    }
  }
}

interface Family {
  readonly family: SignalFamily
  readonly members: readonly Signal[]
}

/** One family's contribution to one finding, inside its caps. */
function familyLlr({ family, members }: Family, axis: Axis, finding: string): number {
  let direct = 0
  let heuristic = 0
  for (const signal of members) {
    const capped = clamp(tableOf(signal, axis)[finding] ?? 0, TIER_CAPS[signal.calibration])
    if (signal.calibration === 'heuristic') {
      heuristic += capped
    } else {
      direct += capped
    }
  }
  return clamp(direct + clamp(heuristic, HEURISTIC_FAMILY_CAP), FAMILY_CAPS[family])
}

function byFamily(signals: readonly Signal[]): readonly Family[] {
  return SIGNAL_FAMILIES.values
    .map((family) => ({ family, members: signals.filter((signal) => signal.family === family) }))
    .filter(({ members }) => members.length > 0)
}

function axisLlr<F extends string>(
  families: readonly Family[],
  axis: Axis,
  findings: Vocabulary<F>,
): Record<F, number> {
  const sums = findings.values.map((finding): [F, number] => [
    finding,
    families.reduce((total, family) => total + familyLlr(family, axis, finding), 0),
  ])
  return Object.fromEntries(sums) as Record<F, number>
}

/** A base-10 softmax of log prior plus log-likelihood ratio. */
export function posteriorOf<F extends string>(
  prior: Readonly<Record<F, number>>,
  llr: Readonly<Record<F, number>>,
  findings: Vocabulary<F>,
): Readonly<Record<F, number>> {
  const logs = findings.values.map((finding) => Math.log10(prior[finding]) + llr[finding])
  const top = Math.max(...logs)
  const weights = logs.map((log) => 10 ** (log - top))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return Object.freeze(
    Object.fromEntries(findings.values.map((finding, at) => [finding, (weights[at] ?? 0) / total])),
  ) as Readonly<Record<F, number>>
}

/** Every candidate within a tie of the most probable one, in the order `candidates` lists them. */
export function leadersOf<F extends string>(
  posterior: Readonly<Record<F, number>>,
  candidates: readonly F[],
): F[] {
  if (candidates.length === 0) {
    return []
  }
  const top = Math.max(...candidates.map((finding) => posterior[finding]))
  return candidates.filter((finding) => posterior[finding] >= top - TIE)
}

/**
 * The single most probable finding, or `fallback` when the top is shared: two
 * candidates the probes could not separate are not a reading of either.
 */
export function mostProbable<F extends string>(
  posterior: Readonly<Record<F, number>>,
  findings: Vocabulary<F>,
  fallback: F,
  excluded: readonly F[] = [],
): F {
  const leaders = leadersOf(
    posterior,
    findings.values.filter((finding) => !excluded.includes(finding)),
  )
  return leaders.length === 1 && leaders[0] !== undefined ? leaders[0] : fallback
}

function vetoed(
  llr: Record<IdentityFinding, number>,
  signals: readonly Signal[],
): Readonly<Record<IdentityFinding, number>> {
  const held = { ...llr }
  for (const finding of signals.flatMap((signal) => signal.vetoes ?? [])) {
    held[finding] = Math.min(held[finding], VETO_LLR)
  }
  return Object.freeze(held)
}

/**
 * A protocol its vendor does not serve reaches the model through a
 * translation layer, whoever runs it: `direct` is impossible by construction.
 */
function paired(
  llr: Record<TranslationFinding, number>,
  pairing: Pairing,
): Readonly<Record<TranslationFinding, number>> {
  return Object.freeze(
    pairing === 'cross-protocol' ? { ...llr, direct: Math.min(llr.direct, VETO_LLR) } : llr,
  )
}

export function aggregate(signals: readonly Signal[], pairing: Pairing): Aggregate {
  for (const signal of signals) {
    checkSignal(signal)
  }
  const families = byFamily(signals)
  const llr: Llrs = Object.freeze({
    identity: vetoed(axisLlr(families, 'identity', IDENTITY_FINDINGS), signals),
    platform: Object.freeze(axisLlr(families, 'platform', PLATFORM_FINDINGS)),
    translation: paired(axisLlr(families, 'translation', TRANSLATION_FINDINGS), pairing),
  })
  return Object.freeze({
    llr,
    posteriors: Object.freeze({
      identity: posteriorOf(IDENTITY_PRIOR, llr.identity, IDENTITY_FINDINGS),
      platform: posteriorOf(PLATFORM_PRIOR, llr.platform, PLATFORM_FINDINGS),
      translation: posteriorOf(TRANSLATION_PRIOR, llr.translation, TRANSLATION_FINDINGS),
    }),
  })
}
