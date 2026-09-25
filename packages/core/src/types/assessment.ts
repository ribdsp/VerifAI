/**
 * The five independent axes VerifAI scores an endpoint on, grouped into three
 * questions.
 *
 * This replaced a single flat eight-member union (`genuine_first_party`,
 * `genuine_translated`, `model_downgrade`, `partial_routing`, `indeterminate`,
 * ...). One union is one partition, and a partition asserts that its members are
 * mutually exclusive - which for these particular facts is simply false:
 *
 * - a translation gateway can also fractionally route;
 * - a downgraded model can be reached through Bedrock;
 * - an endpoint can block one probe family and answer the rest honestly;
 * - Anthropic's own OpenAI-compatible endpoint is first-party *and* translated.
 *
 * None of those are expressible in a flat union, so the aggregator would have had
 * to pick a winner between two things that were both true, and the report would
 * have named one of them while silently dropping the other. The last one is why
 * "how the request gets there" is two axes rather than one.
 *
 * | Question               | Axis          | Asks                                             |
 * |------------------------|---------------|--------------------------------------------------|
 * | Who answers?           | `identity`    | Which model is actually answering?               |
 * |                        | `consistency` | Does that hold for every request, or only some?  |
 * | How does it get there? | `platform`    | Whose infrastructure serves the model?           |
 * |                        | `translation` | Is a protocol translation layer in the path?     |
 * | What limited us?       | `evidence`    | How much did we establish, and what stopped us?  |
 *
 * `platform` and `translation` are the fairness axes. A partner cloud and a
 * translation layer both change the fingerprints without being fraud, and scoring
 * either on the identity axis is the single easiest way for a tool like this to
 * defame an honest operator. Neither ever moves the verdict.
 *
 * `evidence` is the honesty axis, and it fixes a double-count in the old design:
 * `indeterminate` meant both "this endpoint is hiding something" and "you chose
 * the cheap profile", so an honest seller checked on `quick` was charged twice for
 * one fact - once by a lowered confidence ceiling, and again by probability mass
 * landing on a label that reads like an accusation.
 */

import { type Member, subset, vocabulary } from './vocabulary.js'

/**
 * Which model is actually answering, relative to the one advertised.
 *
 * Under `consistency: 'fractional'` this describes the share of traffic that does
 * *not* reach the advertised model - see `CONSISTENCY_FINDINGS`.
 */
export const IDENTITY_FINDINGS = vocabulary([
  /** The backend behaves like the advertised model. */
  'matches-claim',
  /**
   * The advertised vendor, but a cheaper or older model than the one sold, or a
   * reduced-precision build of it.
   */
  'same-vendor-cheaper',
  /** Sold as Claude, served by GPT or an open-weight model - or the reverse. */
  'different-vendor',
  /** Canned, replayed, or mocked responses rather than any live model. */
  'not-a-live-model',
  /** The probes that ran do not separate the candidates. See the `evidence` axis for why. */
  'unknown',
])
export type IdentityFinding = Member<typeof IDENTITY_FINDINGS>

/**
 * Identity findings that mean the buyer was shortchanged.
 *
 * `unknown` is deliberately absent: an unfinished measurement is not an
 * accusation. `matches-claim` is the only clearing finding, so this subset plus
 * those two members is the whole axis - asserted in the tests rather than
 * restated here, so the two lists cannot drift apart.
 */
export const ADVERSE_IDENTITY_FINDINGS = subset(IDENTITY_FINDINGS, [
  'same-vendor-cheaper',
  'different-vendor',
  'not-a-live-model',
])
export type AdverseIdentityFinding = Member<typeof ADVERSE_IDENTITY_FINDINGS>

/**
 * Whether the `identity` finding holds for every request, or only for a share.
 *
 * Fractional routing - sending only part of the traffic to the advertised model -
 * is the most economically rational way to cheat, and a single match/mismatch
 * verdict misses it entirely. It gets its own axis so that "genuine 70% of the
 * time" cannot be reported as genuine.
 *
 * This axis is about identity and nothing else. The same model load-balanced
 * across first-party and a partner cloud is `uniform`: every request reaches the
 * model that was sold. That only holds if the measurement respects it, so
 * dilution is measured on deterministic identity-revealing probes whose answer
 * does not depend on platform or translation. Dispersion in platform or
 * translation signals is never counted as a mixture.
 */
export const CONSISTENCY_FINDINGS = vocabulary([
  /**
   * Repeated identity probes agree. This bounds the share that could be going
   * elsewhere; it does not certify that share is zero. `docs/scoring.md` gives
   * the bound for each repetition count.
   */
  'uniform',
  /**
   * Repeated identity probes disagree beyond sampling noise: a mixture. `identity`
   * then describes the share that is not the claimed model, or is `unknown` -
   * never `matches-claim`, which `verdictFor` refuses.
   */
  'fractional',
  /** Too few repetitions to tell the two apart. */
  'unknown',
])
export type ConsistencyFinding = Member<typeof CONSISTENCY_FINDINGS>

/**
 * Whose infrastructure serves the model. **Every member of this axis is legitimate.**
 *
 * It exists to explain away fingerprint differences that would otherwise read as
 * substitution, not to grade anyone: a partner-cloud deployment fails large parts
 * of the first-party conformance catalogue while serving exactly the model it
 * advertises.
 */
export const PLATFORM_FINDINGS = vocabulary([
  /** The vendor's own API, or a pass-through thin enough to be indistinguishable. */
  'first-party',
  /** The vendor's model hosted by a cloud partner - Bedrock, Vertex AI, Foundry, Azure OpenAI. */
  'partner-cloud',
  /**
   * Not established, or a mixture of platforms. A mixture is a load-balancing
   * choice, not a finding against anyone; its dispersion stays visible in the
   * signal table instead.
   */
  'unknown',
])
export type PlatformFinding = Member<typeof PLATFORM_FINDINGS>

/**
 * Whether a protocol translation layer sits between the buyer and the model.
 * **Every member of this axis is legitimate.**
 *
 * Separate from `platform` because the two vary independently: Anthropic's own
 * OpenAI SDK compatibility layer is first-party and translated at once. A
 * translation layer erases vendor-specific signals by construction, so it
 * explains failed conformance probes without implying anything about which model
 * is behind it.
 */
export const TRANSLATION_FINDINGS = vocabulary([
  /** The model is reached over the protocol its vendor serves natively, unrewritten. */
  'direct',
  /** A layer rewrites between the buyer's protocol and the model's. Not fraud. */
  'translated',
  /** Not established, or a mixture of translated and direct paths. */
  'unknown',
])
export type TranslationFinding = Member<typeof TRANSLATION_FINDINGS>

/**
 * What limited the measurement - the report's account of its own coverage.
 *
 * The distinction between the last two members is the whole point of the axis:
 * `budget-limited` is our choice and is not held against the endpoint, while
 * `obstructed` is the endpoint's behaviour and is evidence in its own right.
 */
export const EVIDENCE_FINDINGS = vocabulary([
  /** The planned probes ran and answered. */
  'sufficient',
  /** Probes were skipped to stay inside the token/request budget. Our limit, not a finding. */
  'budget-limited',
  /** The endpoint refused, stalled, or returned unusable data for probes it should answer. */
  'obstructed',
])
export type EvidenceFinding = Member<typeof EVIDENCE_FINDINGS>

/** One reading of an endpoint: one finding on each of the five axes. */
export interface Assessment {
  readonly identity: IdentityFinding
  readonly consistency: ConsistencyFinding
  readonly platform: PlatformFinding
  readonly translation: TranslationFinding
  readonly evidence: EvidenceFinding
}

/**
 * The single word a layperson reads first. Rendered green / yellow / red.
 *
 * Derived from an `Assessment` plus a confidence, never stored as an independent
 * field - so it cannot contradict the axes it is supposed to summarise.
 */
export const VERDICTS = vocabulary([
  /** Behaves like the advertised model, with enough evidence to say so. */
  'pass',
  /** Something is unresolved. Not reassurance: read the axes. */
  'caution',
  /** Adverse finding, held to a higher evidential bar than `pass`. */
  'fail',
])
export type Verdict = Member<typeof VERDICTS>

/**
 * Confidence a clearing assessment needs before the report says `pass`.
 *
 * Below this the answer is `caution`, which is the honest reading of "the probes
 * we ran found nothing wrong and there were not many of them". A buyer acting on
 * a false `pass` pays for a model they are not getting.
 */
export const MINIMUM_PASS_CONFIDENCE = 0.8

/**
 * Confidence an adverse assessment needs before the report says `fail`.
 *
 * Deliberately higher than the `pass` bar. A `fail` is a publishable claim about
 * a named business, and the harm is asymmetric: a wrongly cautious report costs a
 * buyer one more check, a wrongly failing report can cost an honest operator its
 * customers. The published false-positive rate against
 * `packages/core/test/fakes/` is what justifies this number staying where it is.
 */
export const MINIMUM_FAIL_CONFIDENCE = 0.9

/**
 * Collapses the five axes and a confidence into the headline verdict.
 *
 * Note which axes are *not* consulted: `platform` and `translation`. Every one of
 * their members is legitimate, so they explain the evidence without ever changing
 * the verdict.
 *
 * Note also how `evidence` is consulted. `obstructed` blocks a `pass` outright,
 * because an endpoint that refused inspection has not been cleared by the probes
 * it did allow. `budget-limited` is absent entirely - it reaches the verdict only
 * by lowering `confidence`, which is the one place coverage is allowed to count.
 * Reading it here as well would restore the double-count this axis was added to
 * remove.
 *
 * @param confidence Posterior confidence in `assessment`, in [0, 1].
 * @throws RangeError if `confidence` is not a finite number in [0, 1]. A NaN
 * confidence silently becoming `caution` would be a scoring bug that reads as a
 * cautious result, which is exactly the kind of failure this project cannot ship.
 * @throws TypeError if `assessment` pairs `consistency: 'fractional'` with
 * `identity: 'matches-claim'`. Under a mixture, `identity` describes the share
 * that is not the claimed model; naming the claimed model there is what an
 * aggregator produces when it averages the mixture away - the exact failure the
 * `consistency` axis exists to catch.
 */
export function verdictFor(assessment: Assessment, confidence: number): Verdict {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new RangeError(`confidence must be a finite number in [0, 1], received ${confidence}`)
  }

  if (assessment.consistency === 'fractional' && assessment.identity === 'matches-claim') {
    throw new TypeError(
      'A fractional assessment cannot name the claimed model: under a mixture, identity describes the share that is not the claimed model, or is unknown',
    )
  }

  const isAdverse =
    ADVERSE_IDENTITY_FINDINGS.has(assessment.identity) || assessment.consistency === 'fractional'

  if (isAdverse) {
    return confidence >= MINIMUM_FAIL_CONFIDENCE ? 'fail' : 'caution'
  }

  if (assessment.evidence === 'obstructed') {
    return 'caution'
  }

  const isCleared = assessment.identity === 'matches-claim' && assessment.consistency === 'uniform'

  return isCleared && confidence >= MINIMUM_PASS_CONFIDENCE ? 'pass' : 'caution'
}
