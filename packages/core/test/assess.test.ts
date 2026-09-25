import { describe, expect, it } from 'vitest'
import type { Signal } from '../src/probes/types.js'
import type { ProbeOutcome } from '../src/runner/types.js'
import { assess, consistencyPosterior, evidenceOf } from '../src/scoring/assess.js'
import { epsilonOf, exactUpper } from '../src/scoring/dispersion.js'
import type { IdentityFinding } from '../src/types/assessment.js'
import { draws, ran, signal, skipped } from './support/scoring.js'

/** One strong signal per family for `finding`: 8 in log10 once the caps are applied. */
function pointingAt(finding: IdentityFinding): Signal[] {
  const llr = { identity: { [finding]: 2 } }
  return [
    signal({ family: 'protocol-conformance', llr }),
    signal({ family: 'accounting', llr }),
    signal({ family: 'tokenizer', llr }),
    signal({ family: 'causal-capability', llr }),
    signal({ family: 'causal-capability', llr }),
  ]
}

const FULL: ProbeOutcome[] = [...ran('ABCD'), ...ran('F')]
const CLEAN = draws('a'.repeat(30))

describe('consistencyPosterior', () => {
  it('believes nothing without enough draws', () => {
    expect(consistencyPosterior(null)).toEqual({ uniform: 0, fractional: 0, unknown: 1 })
    expect(consistencyPosterior(epsilonOf(draws('aaaa')))).toEqual({
      uniform: 0,
      fractional: 0,
      unknown: 1,
    })
  })

  it('believes a clean run short of half the slack its bound leaves', () => {
    const thirty = consistencyPosterior(epsilonOf(CLEAN))
    expect(thirty.uniform).toBeCloseTo(1 - exactUpper(0, 30) / 2, 12)
    expect(thirty.uniform).toBeCloseTo(0.952, 3)
    expect(thirty.uniform + thirty.fractional).toBeCloseTo(1, 12)

    const five = consistencyPosterior(epsilonOf(draws('aaaaa')))
    expect(five.uniform).toBeCloseTo(0.775, 3)
  })

  it('reads every draw disagreeing as uniform, bounded from the other end', () => {
    const posterior = consistencyPosterior(epsilonOf(draws('d'.repeat(12))))
    expect(posterior.uniform).toBeCloseTo(1 - exactUpper(0, 12) / 2, 12)
  })

  it('grows belief in a mixture as 1 - 2^-k with the minority count', () => {
    const stray = (d: number) => `${'d'.repeat(d)}${'a'.repeat(30 - d)}`
    expect(consistencyPosterior(epsilonOf(draws(stray(1)))).fractional).toBe(0.5)
    expect(consistencyPosterior(epsilonOf(draws(stray(3)))).fractional).toBe(0.875)
    expect(consistencyPosterior(epsilonOf(draws(stray(28)))).fractional).toBe(0.75)
    const nine = consistencyPosterior(epsilonOf(draws(stray(9))))
    expect(nine).toEqual({ uniform: 2 ** -9, fractional: 1 - 2 ** -9, unknown: 0 })
  })
})

describe('evidenceOf', () => {
  it('is sufficient when nothing stood in the way', () => {
    expect(evidenceOf(FULL, epsilonOf(CLEAN))).toBe('sufficient')
    expect(evidenceOf([], null)).toBe('sufficient')
  })

  it('reads more than a tenth of the probes erroring as obstruction', () => {
    const tenth = [...ran('A', 6), ...ran('BCD'), ...skipped('A', 'endpoint-error')]
    expect(evidenceOf(tenth, null)).toBe('sufficient')
    expect(evidenceOf([...tenth, ...skipped('B', 'endpoint-error')], null)).toBe('obstructed')
  })

  it('reads more than a tenth of the draws lost as obstruction', () => {
    expect(evidenceOf(FULL, epsilonOf(draws(`${'a'.repeat(27)}lll`)))).toBe('sufficient')
    expect(evidenceOf(FULL, epsilonOf(draws(`${'a'.repeat(26)}llll`)))).toBe('obstructed')
  })

  it('holds our own budget against the run, never against the endpoint', () => {
    expect(evidenceOf([...FULL, ...skipped('C', 'budget-exceeded')], null)).toBe('budget-limited')
    expect(evidenceOf([...FULL, ...skipped('C', 'budget-exceeded', 5)], null)).toBe(
      'budget-limited',
    )
  })

  it('ignores probes that were never evidence', () => {
    const outcomes = [...ran('A'), ...skipped('A', 'endpoint-error'), ...skipped('BCD', 'profile')]
    expect(evidenceOf(outcomes, null)).toBe('obstructed')
    expect(evidenceOf([...outcomes, ...ran('B', 9)], null)).toBe('sufficient')
  })
})

describe('assess', () => {
  it('passes a genuine endpoint that every group and thirty draws agree on', () => {
    const scored = assess({
      signals: pointingAt('matches-claim'),
      outcomes: FULL,
      dilution: CLEAN,
      pairing: 'native',
    })
    expect(scored.headline).toBe('pass')
    expect(scored.assessment).toEqual({
      identity: 'matches-claim',
      consistency: 'uniform',
      platform: 'unknown',
      translation: 'unknown',
      evidence: 'sufficient',
    })
    const expected =
      scored.posteriors.identity['matches-claim'] * scored.posteriors.consistency.uniform
    expect(scored.confidence).toBeCloseTo(expected, 12)
    expect(scored.confidence).toBeCloseTo(0.952, 3)
    expect(scored.ceiling).toEqual({ value: 0.98, reasons: [] })
    expect(scored.epsilon?.trials).toBe(30)
    expect(Object.isFrozen(scored)).toBe(true)
    expect(Object.isFrozen(scored.assessment)).toBe(true)
  })

  it('never passes without Group F, however strong the rest', () => {
    const scored = assess({
      signals: pointingAt('matches-claim'),
      outcomes: FULL,
      dilution: undefined,
      pairing: 'native',
    })
    expect(scored.assessment.consistency).toBe('unknown')
    expect(scored.headline).toBe('caution')
    expect(scored.epsilon).toBeNull()
    expect(scored.posteriors.consistency.unknown).toBe(1)
  })

  it('fails a cheaper model of the same vendor, answering every draw', () => {
    const scored = assess({
      signals: pointingAt('same-vendor-cheaper'),
      outcomes: FULL,
      dilution: draws('d'.repeat(30)),
      pairing: 'native',
    })
    expect(scored.assessment.identity).toBe('same-vendor-cheaper')
    expect(scored.assessment.consistency).toBe('uniform')
    expect(scored.confidence).toBe(0.98)
    expect(scored.headline).toBe('fail')
  })

  it('fails another vendor behind a cross-protocol endpoint', () => {
    const scored = assess({
      signals: pointingAt('different-vendor'),
      outcomes: FULL,
      dilution: undefined,
      pairing: 'cross-protocol',
    })
    expect(scored.confidence).toBe(0.94)
    expect(scored.assessment.translation).toBe('translated')
    expect(scored.headline).toBe('fail')
  })

  it('fails a mixture without naming the claimed model', () => {
    const scored = assess({
      signals: pointingAt('matches-claim'),
      outcomes: FULL,
      dilution: draws('aadaaadaaaadaaadaaadaaadaaadaa'),
      pairing: 'native',
    })
    expect(scored.assessment.consistency).toBe('fractional')
    expect(scored.assessment.identity).toBe('unknown')
    expect(scored.confidence).toBe(0.98)
    expect(scored.headline).toBe('fail')
  })

  it('names the other share of a mixture when the signals point at it', () => {
    const scored = assess({
      signals: [
        ...pointingAt('matches-claim'),
        signal({ llr: { identity: { 'different-vendor': 1 } } }),
      ],
      outcomes: FULL,
      dilution: draws('aadaaadaaaadaaadaaadaaadaaadaa'),
      pairing: 'native',
    })
    expect(scored.assessment.identity).toBe('different-vendor')
    expect(scored.headline).toBe('fail')
  })

  it('holds the unresolved share back from an adverse reading nothing decisive made', () => {
    const scored = assess({
      signals: [
        signal({
          calibration: 'documented',
          llr: { identity: { 'matches-claim': -1, 'different-vendor': 0.4 } },
        }),
      ],
      outcomes: FULL,
      dilution: CLEAN,
      pairing: 'native',
    })
    const { identity } = scored.posteriors
    expect(scored.assessment.identity).toBe('different-vendor')
    expect(scored.confidence).toBeCloseTo(
      identity['same-vendor-cheaper'] + identity['different-vendor'] + identity['not-a-live-model'],
      12,
    )
    expect(scored.headline).toBe('caution')
  })

  it('fails once a veto rules the claim out: what is unresolved is then not the claim', () => {
    const scored = assess({
      signals: [
        signal({
          family: 'causal-capability',
          calibration: 'documented',
          llr: { identity: { 'matches-claim': -1, 'different-vendor': 0.5 } },
          vetoes: ['matches-claim', 'same-vendor-cheaper'],
        }),
      ],
      outcomes: FULL,
      dilution: CLEAN,
      pairing: 'native',
    })
    expect(scored.assessment.identity).toBe('different-vendor')
    expect(scored.posteriors.identity.unknown).toBeGreaterThan(0.1)
    expect(scored.confidence).toBeCloseTo(
      Math.min(1 - scored.posteriors.identity['matches-claim'], scored.ceiling.value),
      12,
    )
    expect(scored.headline).toBe('fail')
  })

  it('never reads a ruled-out claim as unresolved, however much weight lands on unknown', () => {
    const scored = assess({
      signals: [
        signal({
          family: 'causal-capability',
          calibration: 'documented',
          llr: { identity: { 'matches-claim': -1, 'different-vendor': 0.5 } },
          vetoes: ['matches-claim', 'same-vendor-cheaper'],
        }),
        signal({
          family: 'accounting',
          calibration: 'documented',
          llr: { identity: { unknown: 1, 'not-a-live-model': 0.8 } },
        }),
      ],
      outcomes: FULL,
      dilution: CLEAN,
      pairing: 'native',
    })
    const { identity } = scored.posteriors
    expect(identity.unknown).toBeGreaterThan(identity['not-a-live-model'])
    expect(scored.assessment.identity).toBe('not-a-live-model')
    expect(scored.headline).toBe('fail')
  })

  it('names the mildest adverse finding a veto leaves standing when nothing separates them', () => {
    const scored = assess({
      signals: [
        signal({
          family: 'causal-capability',
          calibration: 'documented',
          llr: { identity: { 'matches-claim': -1 } },
          vetoes: ['matches-claim'],
        }),
      ],
      outcomes: FULL,
      dilution: CLEAN,
      pairing: 'native',
    })
    expect(scored.assessment.identity).toBe('same-vendor-cheaper')
    expect(scored.headline).toBe('fail')
  })

  it('is left unresolved when the vetoes rule out every finding', () => {
    const scored = assess({
      signals: [
        signal({
          family: 'causal-capability',
          calibration: 'documented',
          llr: { identity: { 'matches-claim': -1 } },
          vetoes: ['matches-claim', 'same-vendor-cheaper', 'different-vendor', 'not-a-live-model'],
        }),
      ],
      outcomes: FULL,
      dilution: CLEAN,
      pairing: 'native',
    })
    expect(scored.assessment.identity).toBe('unknown')
    expect(scored.headline).toBe('caution')
  })

  it('does not fail an endpoint over one stray draw', () => {
    const scored = assess({
      signals: pointingAt('matches-claim'),
      outcomes: FULL,
      dilution: draws(`${'a'.repeat(29)}d`),
      pairing: 'native',
    })
    expect(scored.assessment.consistency).toBe('fractional')
    expect(scored.confidence).toBe(0.5)
    expect(scored.headline).toBe('caution')
  })

  it('never clears an endpoint that obstructed the run', () => {
    const scored = assess({
      signals: pointingAt('matches-claim'),
      outcomes: [...FULL, ...skipped('A', 'endpoint-error', 2)],
      dilution: CLEAN,
      pairing: 'native',
    })
    expect(scored.assessment.evidence).toBe('obstructed')
    expect(scored.headline).toBe('caution')
  })

  it('lets a budget-limited run pass, with the gap taken off its ceiling', () => {
    const scored = assess({
      signals: pointingAt('matches-claim'),
      outcomes: [...FULL, ...skipped('C', 'budget-exceeded')],
      dilution: CLEAN,
      pairing: 'native',
    })
    expect(scored.assessment.evidence).toBe('budget-limited')
    expect(scored.ceiling.reasons).toEqual(['probes-skipped'])
    expect(scored.confidence).toBeCloseTo(0.98 - 0.2 / 6, 8)
    expect(scored.headline).toBe('pass')
  })

  it('stays at caution when the signals could not tell', () => {
    const scored = assess({ signals: [], outcomes: FULL, dilution: CLEAN, pairing: 'native' })
    expect(scored.assessment.identity).toBe('unknown')
    expect(scored.confidence).toBeCloseTo(0.3, 12)
    expect(scored.headline).toBe('caution')
  })

  it('holds a conformance-only run below the pass bar', () => {
    const scored = assess({
      signals: pointingAt('matches-claim'),
      outcomes: [...ran('AF'), ...skipped('BCD', 'profile')],
      dilution: CLEAN,
      pairing: 'native',
    })
    expect(scored.confidence).toBe(0.6)
    expect(scored.headline).toBe('caution')
  })
})
