import { describe, expect, it } from 'vitest'
import {
  ADVERSE_IDENTITY_FINDINGS,
  type Assessment,
  CONSISTENCY_FINDINGS,
  EVIDENCE_FINDINGS,
  IDENTITY_FINDINGS,
  MINIMUM_FAIL_CONFIDENCE,
  MINIMUM_PASS_CONFIDENCE,
  PLATFORM_FINDINGS,
  TRANSLATION_FINDINGS,
  VERDICTS,
  verdictFor,
} from '../src/types/assessment.js'

/** A clean reading of a first-party endpoint, for tests that vary one axis. */
const CLEARED: Assessment = {
  identity: 'matches-claim',
  consistency: 'uniform',
  platform: 'first-party',
  translation: 'direct',
  evidence: 'sufficient',
}

describe('the five assessment axes', () => {
  it('partitions identity into exactly adverse, clearing, and unknown', () => {
    // The two lists are declared separately, so this is what stops them drifting:
    // a new identity finding must be classified on the same commit that adds it,
    // or it silently falls through `verdictFor` into `caution` forever.
    const unclassified = IDENTITY_FINDINGS.values.filter(
      (finding) => !ADVERSE_IDENTITY_FINDINGS.has(finding),
    )

    expect(unclassified).toEqual(['matches-claim', 'unknown'])
  })

  it('treats every platform and translation finding as legitimate', () => {
    // A partner-cloud deployment and a translation layer both fail large parts of
    // the first-party conformance catalogue while serving exactly the model they
    // advertise. Wrongly grading either one is the defamation case in the threat
    // model, so neither axis has an adverse subset to check against.
    expect(PLATFORM_FINDINGS.values).toEqual(['first-party', 'partner-cloud', 'unknown'])
    expect(TRANSLATION_FINDINGS.values).toEqual(['direct', 'translated', 'unknown'])
  })

  it('separates our budget limit from the endpoint obstructing us', () => {
    // The distinction this axis exists for. Collapsing them charges an honest
    // seller twice for one fact: once by a lowered ceiling, once by a label that
    // reads like an accusation.
    expect(EVIDENCE_FINDINGS.has('budget-limited')).toBe(true)
    expect(EVIDENCE_FINDINGS.has('obstructed')).toBe(true)
  })
})

describe('verdictFor', () => {
  it('clears a matching endpoint once the evidence justifies it', () => {
    expect(verdictFor(CLEARED, MINIMUM_PASS_CONFIDENCE)).toBe('pass')
    expect(verdictFor(CLEARED, 1)).toBe('pass')
  })

  it('will not say pass on thin evidence', () => {
    // "The probes we ran found nothing wrong, and there were not many of them" is
    // a caution, not reassurance. A buyer acting on a false pass keeps paying for
    // a model they are not getting.
    expect(verdictFor(CLEARED, MINIMUM_PASS_CONFIDENCE - 0.01)).toBe('caution')
    expect(verdictFor(CLEARED, 0)).toBe('caution')
  })

  it('holds an accusation to a higher bar than a clearance', () => {
    // Asymmetric harm: a wrongly cautious report costs a buyer one more check, a
    // wrongly failing report can cost an honest operator its customers.
    expect(MINIMUM_FAIL_CONFIDENCE).toBeGreaterThan(MINIMUM_PASS_CONFIDENCE)
  })

  it('fails every adverse identity finding, but only when confident', () => {
    for (const identity of ADVERSE_IDENTITY_FINDINGS.values) {
      expect(verdictFor({ ...CLEARED, identity }, MINIMUM_FAIL_CONFIDENCE)).toBe('fail')
      expect(verdictFor({ ...CLEARED, identity }, MINIMUM_FAIL_CONFIDENCE - 0.01)).toBe('caution')
    }
  })

  it('fails a fractional router, because genuine 70% of the time is not genuine', () => {
    // Under a mixture, `identity` describes the share that is not the claimed
    // model. `unknown` is the case that matters: a mixture whose other share went
    // unidentified is still a mixture, and must not fall back to the milder
    // unresolved-identity caution.
    const diluents = IDENTITY_FINDINGS.values.filter((finding) => finding !== 'matches-claim')

    for (const identity of diluents) {
      const fractional: Assessment = { ...CLEARED, identity, consistency: 'fractional' }

      expect(verdictFor(fractional, 1)).toBe('fail')
      // Dispersion needs enough repetitions to separate a mixture from sampling
      // noise, so a low-confidence fractional reading must not accuse anyone.
      expect(verdictFor(fractional, 0.5)).toBe('caution')
    }
  })

  it('rejects a fractional reading that still names the advertised model', () => {
    // The averaging bug, caught at the boundary. Pool the signals from a 70/30
    // mixture and the claimed model is the most probable identity - which is
    // precisely the reading that hides the other 30%. Refused at any confidence,
    // because it is a malformed assessment rather than a weak one.
    const incoherent: Assessment = { ...CLEARED, consistency: 'fractional' }

    expect(() => verdictFor(incoherent, 1)).toThrow(TypeError)
    expect(() => verdictFor(incoherent, 0)).toThrow(/fractional/)
  })

  it('never clears an endpoint whose identity is unresolved', () => {
    // An unresolved reading is not a clean bill of health. Asserted at confidence
    // 1 so it cannot pass for a coverage effect.
    expect(verdictFor({ ...CLEARED, identity: 'unknown' }, 1)).toBe('caution')
    expect(verdictFor({ ...CLEARED, consistency: 'unknown' }, 1)).toBe('caution')
  })

  it('never clears an endpoint that obstructed inspection', () => {
    // An endpoint is not cleared by the probes it permitted. Resisting inspection
    // makes it more suspicious, not less.
    expect(verdictFor({ ...CLEARED, evidence: 'obstructed' }, 1)).toBe('caution')
  })

  it('does not hold our own budget against the endpoint', () => {
    // The regression this axis was introduced to prevent. Coverage reaches the
    // verdict through `confidence` alone; reading it a second time here would
    // make a cheap profile permanently unable to clear an honest endpoint.
    expect(verdictFor({ ...CLEARED, evidence: 'budget-limited' }, 1)).toBe('pass')
  })

  it('ignores the platform and translation axes entirely', () => {
    // Partner clouds and translation layers change the fingerprints without
    // changing who is right, so they may explain the evidence but never move the
    // verdict. Every pairing is covered, including first-party and translated at
    // once - which is what Anthropic's own OpenAI SDK compatibility layer is.
    for (const platform of PLATFORM_FINDINGS.values) {
      for (const translation of TRANSLATION_FINDINGS.values) {
        const route = { platform, translation }

        expect(verdictFor({ ...CLEARED, ...route }, 1)).toBe('pass')
        expect(verdictFor({ ...CLEARED, ...route, identity: 'different-vendor' }, 1)).toBe('fail')
      }
    }
  })

  it('answers every coherent combination and refuses exactly the incoherent one', () => {
    // Exhaustive rather than a hand-picked sample, so a future branch cannot
    // return undefined for a combination nobody thought to enumerate. The length
    // assertion keeps it from silently becoming vacuous if an axis empties out.
    const combinations = IDENTITY_FINDINGS.values.flatMap((identity) =>
      CONSISTENCY_FINDINGS.values.flatMap((consistency) =>
        PLATFORM_FINDINGS.values.flatMap((platform) =>
          TRANSLATION_FINDINGS.values.flatMap((translation) =>
            EVIDENCE_FINDINGS.values.map(
              (evidence): Assessment => ({
                identity,
                consistency,
                platform,
                translation,
                evidence,
              }),
            ),
          ),
        ),
      ),
    )

    expect(combinations).toHaveLength(5 * 3 * 3 * 3 * 3)

    for (const assessment of combinations) {
      const isIncoherent =
        assessment.identity === 'matches-claim' && assessment.consistency === 'fractional'

      for (const confidence of [0, MINIMUM_PASS_CONFIDENCE, MINIMUM_FAIL_CONFIDENCE, 1]) {
        if (isIncoherent) {
          expect(() => verdictFor(assessment, confidence)).toThrow(TypeError)
        } else {
          expect(VERDICTS.has(verdictFor(assessment, confidence))).toBe(true)
        }
      }
    }
  })

  it('refuses a confidence that is not a probability', () => {
    // A NaN confidence quietly collapsing to `caution` would be a scoring bug
    // that reads as a cautious result - indistinguishable from working software.
    expect(() => verdictFor(CLEARED, Number.NaN)).toThrow(RangeError)
    expect(() => verdictFor(CLEARED, -0.1)).toThrow(RangeError)
    expect(() => verdictFor(CLEARED, 1.1)).toThrow(RangeError)
    expect(() => verdictFor(CLEARED, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
