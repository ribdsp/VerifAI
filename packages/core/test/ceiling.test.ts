import { describe, expect, it } from 'vitest'
import type { ProbeOutcome } from '../src/runner/types.js'
import {
  applicableOutcomes,
  CONFORMANCE_ONLY_CEILING,
  ceilingFor,
  FULL_COVERAGE_CEILING,
  gapShare,
  groupRan,
  NO_CAUSAL_CEILING,
  ONE_OF_B_C_CEILING,
} from '../src/scoring/ceiling.js'
import { ran, signal, skipped } from './support/scoring.js'

const MEASURED = [signal({ calibration: 'measured', llr: {} })]
const DOCUMENTED = [signal({ calibration: 'documented', llr: {} })]

describe('coverage ceiling', () => {
  it('claims at most 0.98 when every group ran', () => {
    const ceiling = ceilingFor(ran('ABCD'), MEASURED, 'native')
    expect(ceiling).toEqual({ value: FULL_COVERAGE_CEILING, reasons: [] })
    expect(Object.isFrozen(ceiling)).toBe(true)
    expect(Object.isFrozen(ceiling.reasons)).toBe(true)
  })

  it('drops to 0.88 without the causal probes', () => {
    const ceiling = ceilingFor([...ran('ABC'), ...skipped('D', 'profile')], MEASURED, 'native')
    expect(ceiling).toEqual({ value: NO_CAUSAL_CEILING, reasons: ['group-d-not-run'] })
  })

  it('drops to 0.75 with only one of B and C', () => {
    expect(ceilingFor(ran('ABD'), MEASURED, 'native')).toEqual({
      value: ONE_OF_B_C_CEILING,
      reasons: ['group-c-not-run'],
    })
    expect(ceilingFor(ran('ACD'), MEASURED, 'native')).toEqual({
      value: ONE_OF_B_C_CEILING,
      reasons: ['group-b-not-run'],
    })
  })

  it('holds conformance alone at 0.6, with or without D', () => {
    expect(ceilingFor(ran('AD'), MEASURED, 'native')).toEqual({
      value: CONFORMANCE_ONLY_CEILING,
      reasons: ['groups-b-c-not-run'],
    })
    expect(ceilingFor(ran('A'), MEASURED, 'native')).toEqual({
      value: CONFORMANCE_ONLY_CEILING,
      reasons: ['groups-b-c-not-run', 'group-d-not-run'],
    })
  })

  it('takes 0.04 off a cross-protocol pairing, and still leaves room to fail', () => {
    const ceiling = ceilingFor(ran('ABCD'), MEASURED, 'cross-protocol')
    expect(ceiling).toEqual({ value: 0.94, reasons: ['cross-protocol'] })
    expect(ceiling.value).toBeGreaterThanOrEqual(0.9)
  })

  it('takes 0.2 per unit of gap share', () => {
    const outcomes = [...ran('A', 6), ...ran('BCD'), ...skipped('A', 'endpoint-error')]
    expect(gapShare(outcomes)).toBeCloseTo(0.1, 12)
    expect(ceilingFor(outcomes, MEASURED, 'native')).toEqual({
      value: 0.96,
      reasons: ['probes-skipped'],
    })
  })

  it('takes 0.02 off a run where no signal rests on recorded ground truth', () => {
    expect(ceilingFor(ran('ABCD'), DOCUMENTED, 'native')).toEqual({
      value: 0.96,
      reasons: ['calibration-documented-only'],
    })
    expect(ceilingFor(ran('ABCD'), [], 'native').reasons).toEqual(['calibration-documented-only'])
  })

  it('rounds, so short decimals stay short', () => {
    const ceiling = ceilingFor(ran('ABCD'), DOCUMENTED, 'cross-protocol')
    expect(ceiling.value).toBe(0.92)
    expect(ceiling.reasons).toEqual(['cross-protocol', 'calibration-documented-only'])
  })

  it('stacks every reason in a fixed order', () => {
    const outcomes = [...ran('A', 3), ...skipped('A', 'blocked'), ...skipped('BCD', 'profile')]
    const ceiling = ceilingFor(outcomes, DOCUMENTED, 'cross-protocol')
    expect(ceiling.reasons).toEqual([
      'groups-b-c-not-run',
      'group-d-not-run',
      'cross-protocol',
      'probes-skipped',
      'calibration-documented-only',
    ])
    expect(ceiling.value).toBe(0.49)
  })
})

describe('what counts as run', () => {
  it('counts a group when at least half its applicable probes finished', () => {
    expect(groupRan([...ran('B'), ...skipped('B', 'budget-exceeded')], 'B')).toBe(true)
    expect(groupRan([...ran('B'), ...skipped('B', 'blocked', 2)], 'B')).toBe(false)
    expect(groupRan([...ran('B'), ...skipped('B', 'not-applicable', 5)], 'B')).toBe(true)
    expect(groupRan(skipped('B', 'not-applicable'), 'B')).toBe(false)
    expect(groupRan(ran('A'), 'B')).toBe(false)
  })

  it('never counts what had nothing to measure, or was never asked for, as a gap', () => {
    const outcomes = [
      ...ran('A'),
      ...skipped('A', 'not-applicable'),
      ...skipped('F', 'opt-in'),
      ...skipped('D', 'profile'),
    ]
    expect(applicableOutcomes(outcomes)).toHaveLength(1)
    expect(gapShare(outcomes)).toBe(0)
  })

  it('counts every gap reason against the run', () => {
    const reasons = [
      'needs-api-key',
      'budget-exceeded',
      'endpoint-error',
      'unsupported-by-transport',
      'blocked',
      'aborted',
      'probe-error',
    ] as const
    for (const reason of reasons) {
      expect(gapShare([...ran('A'), ...skipped('A', reason)])).toBe(0.5)
    }
    expect(gapShare([])).toBe(0)
  })

  it('refuses a skip that does not say why', () => {
    const silent = { probeId: 'a/silent', group: 'A', status: 'skipped' } as ProbeOutcome
    expect(() => applicableOutcomes([silent])).toThrow(TypeError)
    const invented = { ...silent, reason: 'felt-like-it' } as unknown as ProbeOutcome
    expect(() => ceilingFor([invented], MEASURED, 'native')).toThrow(/must say why/)
  })
})
