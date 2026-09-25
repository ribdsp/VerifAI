/**
 * Everything the run found, read as one assessment with a confidence.
 *
 * The order matters. Consistency comes from the draws alone, so a mixture is
 * decided before identity is read. Under a mixture, identity names the share
 * that is not the claimed model. Confidence is the posterior of whichever
 * claim the headline makes, held under the coverage ceiling. The headline
 * itself comes from `verdictFor`, which is where the pass and fail bars live.
 */

import type { Signal } from '../probes/types.js'
import type { Epsilon, Posteriors } from '../report/types.js'
import type { DilutionRun, ProbeOutcome } from '../runner/types.js'
import {
  ADVERSE_IDENTITY_FINDINGS,
  type Assessment,
  type ConsistencyFinding,
  type EvidenceFinding,
  IDENTITY_FINDINGS,
  type IdentityFinding,
  PLATFORM_FINDINGS,
  TRANSLATION_FINDINGS,
  type Verdict,
  verdictFor,
} from '../types/assessment.js'
import type { Pairing } from '../types/target.js'
import { aggregate, leadersOf, mostProbable } from './aggregate.js'
import { applicableOutcomes, type Ceiling, ceilingFor } from './ceiling.js'
import { consistencyOf, epsilonOf, lostShare, MAX_LOST_SHARE } from './dispersion.js'

/** More lost probes than this share of the applicable ones, and the endpoint obstructed the run. */
export const MAX_ENDPOINT_ERROR_SHARE = 0.1

export interface Scoring {
  readonly signals: readonly Signal[]
  readonly outcomes: readonly ProbeOutcome[]
  readonly dilution: DilutionRun | undefined
  readonly pairing: Pairing
}

export interface Scored {
  readonly headline: Verdict
  readonly assessment: Assessment
  readonly confidence: number
  readonly ceiling: Ceiling
  readonly posteriors: Posteriors
  readonly epsilon: Epsilon | null
}

/** Our limits are not held against the endpoint; its refusals are. */
export function evidenceOf(
  outcomes: readonly ProbeOutcome[],
  epsilon: Epsilon | null,
): EvidenceFinding {
  const applicable = applicableOutcomes(outcomes)
  const errors = applicable.filter((outcome) => outcome.reason === 'endpoint-error').length
  const erroring = applicable.length > 0 && errors / applicable.length > MAX_ENDPOINT_ERROR_SHARE
  if (erroring || lostShare(epsilon) > MAX_LOST_SHARE) {
    return 'obstructed'
  }
  return outcomes.some((outcome) => outcome.reason === 'budget-exceeded')
    ? 'budget-limited'
    : 'sufficient'
}

/**
 * How far to believe the consistency reading, which is itself a pure function
 * of the draws.
 *
 * `uniform` is believed short of the slack its bound leaves: half of c, so 30
 * clean draws hold 0.95 and five hold 0.77, which is not enough for a pass.
 * `fractional` grows with the minority count k as 1 - 2^-k. One stray reading
 * is an even bet between a mixture and a glitch in the measurement, and each
 * further one halves what is left of the glitch.
 */
export function consistencyPosterior(
  epsilon: Epsilon | null,
): Readonly<Record<ConsistencyFinding, number>> {
  const finding = consistencyOf(epsilon)
  if (epsilon === null || finding === 'unknown') {
    return Object.freeze({ uniform: 0, fractional: 0, unknown: 1 })
  }
  if (finding === 'uniform') {
    const slack = epsilon.disagreements === 0 ? epsilon.interval[1] : 1 - epsilon.interval[0]
    return Object.freeze({ uniform: 1 - slack / 2, fractional: slack / 2, unknown: 0 })
  }
  const minority = Math.min(epsilon.disagreements, epsilon.trials - epsilon.disagreements)
  const fractional = 1 - 2 ** -minority
  return Object.freeze({ uniform: 1 - fractional, fractional, unknown: 0 })
}

/** The findings a decisive probe ruled out, not merely read against. */
function vetoesOf(signals: readonly Signal[]): ReadonlySet<IdentityFinding> {
  return new Set(signals.flatMap((signal) => signal.vetoes ?? []))
}

/**
 * Once the claim is ruled out, the reading is whichever adverse finding the
 * vetoes left standing. `unknown` is not eligible: what the probes could not
 * resolve is still not the claim. When nothing separates the standing findings,
 * the mildest is named, in the order `ADVERSE_IDENTITY_FINDINGS` lists them, so
 * the report never accuses further than the evidence reaches. Vetoes that rule
 * out every finding contradict each other, and that is left unresolved.
 */
function ruledOut(
  posterior: Posteriors['identity'],
  vetoes: ReadonlySet<IdentityFinding>,
): IdentityFinding {
  const standing = ADVERSE_IDENTITY_FINDINGS.values.filter((finding) => !vetoes.has(finding))
  return leadersOf(posterior, standing)[0] ?? 'unknown'
}

function identityOf(
  posterior: Posteriors['identity'],
  consistency: ConsistencyFinding,
  vetoes: ReadonlySet<IdentityFinding>,
): IdentityFinding {
  if (vetoes.has('matches-claim')) {
    return ruledOut(posterior, vetoes)
  }
  // Under a mixture the pooled signals favour the claimed model by construction;
  // naming it is the reading that hides the other share.
  const excluded: IdentityFinding[] = consistency === 'fractional' ? ['matches-claim'] : []
  return mostProbable(posterior, IDENTITY_FINDINGS, 'unknown', excluded)
}

/** The posterior of the claim the headline makes. */
function rawConfidence(
  assessment: Assessment,
  posteriors: Posteriors,
  claimVetoed: boolean,
): number {
  const identity = posteriors.identity
  if (assessment.consistency === 'fractional') {
    return posteriors.consistency.fractional
  }
  if (ADVERSE_IDENTITY_FINDINGS.has(assessment.identity)) {
    // An unresolved reading may be hiding the claimed model, so it is not held against the
    // endpoint - until a veto rules the claim out, and whatever is unresolved is not the claim.
    return claimVetoed
      ? 1 - identity['matches-claim']
      : ADVERSE_IDENTITY_FINDINGS.values.reduce((sum, finding) => sum + identity[finding], 0)
  }
  if (assessment.identity === 'matches-claim') {
    const uniform = assessment.consistency === 'uniform' ? posteriors.consistency.uniform : 1
    return identity['matches-claim'] * uniform
  }
  return identity.unknown
}

export function assess(scoring: Scoring): Scored {
  const epsilon = scoring.dilution === undefined ? null : epsilonOf(scoring.dilution)
  const pooled = aggregate(scoring.signals, scoring.pairing).posteriors
  const posteriors: Posteriors = Object.freeze({
    ...pooled,
    consistency: consistencyPosterior(epsilon),
  })
  const consistency = consistencyOf(epsilon)
  const vetoes = vetoesOf(scoring.signals)
  const assessment: Assessment = Object.freeze({
    identity: identityOf(posteriors.identity, consistency, vetoes),
    consistency,
    platform: mostProbable(posteriors.platform, PLATFORM_FINDINGS, 'unknown'),
    translation: mostProbable(posteriors.translation, TRANSLATION_FINDINGS, 'unknown'),
    evidence: evidenceOf(scoring.outcomes, epsilon),
  })
  const ceiling = ceilingFor(scoring.outcomes, scoring.signals, scoring.pairing)
  const confidence = Math.min(
    rawConfidence(assessment, posteriors, vetoes.has('matches-claim')),
    ceiling.value,
  )
  return Object.freeze({
    headline: verdictFor(assessment, confidence),
    assessment,
    confidence,
    ceiling,
    posteriors,
    epsilon,
  })
}
