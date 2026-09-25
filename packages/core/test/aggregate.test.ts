import { describe, expect, it } from 'vitest'
import type { Signal } from '../src/probes/types.js'
import {
  aggregate,
  FAMILY_CAPS,
  IDENTITY_PRIOR,
  leadersOf,
  mostProbable,
  PLATFORM_PRIOR,
  posteriorOf,
  VETO_LLR,
} from '../src/scoring/aggregate.js'
import {
  IDENTITY_FINDINGS,
  PLATFORM_FINDINGS,
  TRANSLATION_FINDINGS,
} from '../src/types/assessment.js'
import { signal } from './support/scoring.js'

const matches = (value: number) => ({ identity: { 'matches-claim': value } })

describe('aggregate: caps', () => {
  it('leaves the priors alone when nothing was seen', () => {
    const { llr, posteriors } = aggregate([], 'native')
    expect(Object.values(llr.identity)).toEqual([0, 0, 0, 0, 0])
    expect(posteriors.identity['matches-claim']).toBeCloseTo(IDENTITY_PRIOR['matches-claim'], 12)
    expect(posteriors.platform['first-party']).toBeCloseTo(PLATFORM_PRIOR['first-party'], 12)
    expect(mostProbable(posteriors.identity, IDENTITY_FINDINGS, 'unknown')).toBe('unknown')
  })

  it('caps each signal by how its ratio was calibrated', () => {
    const cases = [
      ['measured', 2],
      ['documented', 1],
      ['derived', 0.7],
      ['heuristic', 0.3],
    ] as const
    for (const [calibration, cap] of cases) {
      const { llr } = aggregate(
        [signal({ family: 'causal-capability', calibration, llr: matches(5) })],
        'native',
      )
      expect(llr.identity['matches-claim']).toBeCloseTo(cap, 12)
      const against = aggregate(
        [signal({ family: 'causal-capability', calibration, llr: matches(-5) })],
        'native',
      )
      expect(against.llr.identity['matches-claim']).toBeCloseTo(-cap, 12)
    }
  })

  it('caps the heuristic signals in a family together', () => {
    const heuristic = () =>
      signal({ family: 'tokenizer', calibration: 'heuristic', llr: matches(0.3) })
    const { llr } = aggregate([heuristic(), heuristic(), heuristic()], 'native')
    expect(llr.identity['matches-claim']).toBeCloseTo(0.3, 12)

    const withDirect = aggregate(
      [
        heuristic(),
        heuristic(),
        signal({ family: 'tokenizer', calibration: 'documented', llr: matches(1) }),
      ],
      'native',
    )
    expect(withDirect.llr.identity['matches-claim']).toBeCloseTo(1.3, 12)
  })

  it('caps each family as a whole: twenty error strings are not twenty facts', () => {
    const conformance = Array.from({ length: 20 }, () => signal({ llr: matches(2) }))
    const { llr } = aggregate(conformance, 'native')
    expect(llr.identity['matches-claim']).toBeCloseTo(FAMILY_CAPS['protocol-conformance'], 12)

    const behavioral = aggregate(
      [
        signal({ family: 'behavioral', calibration: 'documented', llr: matches(1) }),
        signal({ family: 'behavioral', calibration: 'heuristic', llr: matches(0.3) }),
      ],
      'native',
    )
    expect(behavioral.llr.identity['matches-claim']).toBeCloseTo(FAMILY_CAPS.behavioral, 12)
  })

  it('adds families to each other, each inside its own cap', () => {
    const { llr } = aggregate(
      [
        signal({ family: 'protocol-conformance', llr: matches(2) }),
        signal({ family: 'accounting', llr: matches(2) }),
        signal({ family: 'tokenizer', llr: matches(2) }),
        signal({ family: 'causal-capability', llr: matches(2) }),
        signal({ family: 'causal-capability', llr: matches(2) }),
      ],
      'native',
    )
    expect(llr.identity['matches-claim']).toBeCloseTo(1.5 + 1.5 + 2 + 3, 12)
  })

  it('reads each axis and finding separately', () => {
    const { llr } = aggregate(
      [
        signal({
          llr: {
            identity: { 'different-vendor': 1 },
            platform: { 'partner-cloud': 0.5 },
            translation: { translated: -0.5 },
          },
        }),
      ],
      'native',
    )
    expect(llr.identity).toMatchObject({ 'different-vendor': 1, 'matches-claim': 0 })
    expect(llr.platform).toMatchObject({ 'partner-cloud': 0.5, 'first-party': 0 })
    expect(llr.translation).toMatchObject({ translated: -0.5, direct: 0 })
  })
})

describe('aggregate: vetoes', () => {
  it('holds a vetoed finding at a million to one against, whatever else was seen', () => {
    const { llr, posteriors } = aggregate(
      [
        signal({ family: 'causal-capability', llr: matches(2) }),
        signal({ family: 'causal-capability', llr: matches(2) }),
        signal({ family: 'tokenizer', llr: matches(2), vetoes: ['matches-claim'] }),
      ],
      'native',
    )
    expect(llr.identity['matches-claim']).toBe(VETO_LLR)
    expect(posteriors.identity['matches-claim']).toBeLessThan(1e-6)
  })

  it('never lifts a finding the sum already put further down', () => {
    const against = (
      [
        'protocol-conformance',
        'accounting',
        'tokenizer',
        'causal-capability',
        'behavioral',
      ] as const
    ).flatMap((family) => [
      signal({ family, llr: matches(-2) }),
      signal({ family, llr: matches(-2) }),
    ])
    const { llr } = aggregate(
      [...against, signal({ llr: {}, vetoes: ['matches-claim'] })],
      'native',
    )
    expect(llr.identity['matches-claim']).toBeCloseTo(-8.7, 12)
  })

  it('rules out a direct connection on a protocol the vendor does not serve', () => {
    const translated = aggregate(
      [signal({ llr: { translation: { direct: 1.5 } } })],
      'cross-protocol',
    )
    expect(translated.llr.translation.direct).toBe(VETO_LLR)
    expect(mostProbable(translated.posteriors.translation, TRANSLATION_FINDINGS, 'unknown')).toBe(
      'translated',
    )

    const native = aggregate([signal({ llr: { translation: { direct: 1.5 } } })], 'native')
    expect(native.llr.translation.direct).toBe(1.5)
  })
})

describe('posteriors', () => {
  it('is a base-10 softmax of log prior plus ratio', () => {
    const posterior = posteriorOf(
      PLATFORM_PRIOR,
      { 'first-party': 1, 'partner-cloud': 0, unknown: 0 },
      PLATFORM_FINDINGS,
    )
    expect(posterior['first-party']).toBeCloseTo(3.5 / 4.15, 12)
    expect(posterior['partner-cloud']).toBeCloseTo(0.35 / 4.15, 12)
    expect(Object.values(posterior).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 12)
  })

  it('stays finite at ratios no exponent could hold', () => {
    const posterior = posteriorOf(
      PLATFORM_PRIOR,
      { 'first-party': 400, 'partner-cloud': -400, unknown: 0 },
      PLATFORM_FINDINGS,
    )
    expect(posterior['first-party']).toBe(1)
    expect(posterior['partner-cloud']).toBe(0)
    expect(Object.isFrozen(posterior)).toBe(true)
  })

  it('reads a shared top as no finding at all', () => {
    const tied = { 'first-party': 0.4, 'partner-cloud': 0.4, unknown: 0.2 }
    expect(mostProbable(tied, PLATFORM_FINDINGS, 'unknown')).toBe('unknown')
    const clear = { 'first-party': 0.5, 'partner-cloud': 0.3, unknown: 0.2 }
    expect(mostProbable(clear, PLATFORM_FINDINGS, 'unknown')).toBe('first-party')
  })

  it('skips the excluded finding when naming the most probable one', () => {
    const posterior = {
      'matches-claim': 0.9,
      'same-vendor-cheaper': 0.06,
      'different-vendor': 0.02,
      'not-a-live-model': 0.01,
      unknown: 0.01,
    }
    expect(mostProbable(posterior, IDENTITY_FINDINGS, 'unknown')).toBe('matches-claim')
    expect(mostProbable(posterior, IDENTITY_FINDINGS, 'unknown', ['matches-claim'])).toBe(
      'same-vendor-cheaper',
    )
    expect(
      mostProbable(posterior, IDENTITY_FINDINGS, 'unknown', [
        'matches-claim',
        'same-vendor-cheaper',
      ]),
    ).toBe('different-vendor')
  })

  it('lists every finding within a tie of the top, in the order it was given them', () => {
    const posterior = { first: 0.4, second: 0.2, third: 0.4 }
    expect(leadersOf(posterior, ['first', 'second', 'third'])).toEqual(['first', 'third'])
    expect(leadersOf(posterior, ['third', 'second', 'first'])).toEqual(['third', 'first'])
    expect(leadersOf(posterior, ['second'])).toEqual(['second'])
    expect(leadersOf(posterior, [])).toEqual([])
  })

  it('freezes what it returns', () => {
    const result = aggregate([signal({ llr: matches(1) })], 'native')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.llr.identity)).toBe(true)
    expect(Object.isFrozen(result.posteriors.translation)).toBe(true)
  })
})

describe('aggregate: construction errors', () => {
  const broken = (patch: Record<string, unknown>) =>
    ({ ...signal({ llr: matches(1) }), ...patch }) as unknown as Signal

  it('has no path in for a family that is not on the list', () => {
    expect(() => aggregate([broken({ family: 'self-report' })], 'native')).toThrow(TypeError)
    expect(() => aggregate([broken({ family: 'style' })], 'native')).toThrow(/not a signal family/)
  })

  it('refuses an unknown calibration, axis or finding', () => {
    expect(() => aggregate([broken({ calibration: 'guess' })], 'native')).toThrow(
      /not a calibration/,
    )
    expect(() => aggregate([broken({ llr: { mood: { happy: 1 } } })], 'native')).toThrow(
      /no ratios/,
    )
    expect(() => aggregate([broken({ llr: { identity: { 'gpt-7': 1 } } })], 'native')).toThrow(
      /not a finite ratio/,
    )
    expect(() => aggregate([broken({ llr: { consistency: { uniform: 1 } } })], 'native')).toThrow(
      /no ratios/,
    )
  })

  it('refuses a ratio that is not a finite number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      expect(() =>
        aggregate([broken({ llr: { identity: { unknown: value } } })], 'native'),
      ).toThrow(TypeError)
    }
  })

  it('refuses a veto of something that is not an identity finding', () => {
    expect(() => aggregate([broken({ vetoes: ['direct'] })], 'native')).toThrow(/cannot veto/)
  })
})
