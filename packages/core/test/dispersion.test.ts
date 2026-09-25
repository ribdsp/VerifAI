import { describe, expect, it } from 'vitest'
import type { DilutionRun, DrawRecord } from '../src/runner/types.js'
import {
  consistencyOf,
  epsilonInterval,
  epsilonOf,
  exactUpper,
  fewRunsProbability,
  lostShare,
  runsIn,
  wilsonLower,
  wilsonUpper,
} from '../src/scoring/dispersion.js'

function run(outcomes: string): DilutionRun {
  const names = { a: 'agree', d: 'disagree', l: 'lost', x: 'excluded' } as const
  const draws: DrawRecord[] = [...outcomes].map((letter, index) => ({
    draw: index + 1,
    outcome: names[letter as keyof typeof names],
  }))
  return {
    probeId: 'dilution/test',
    basis: 'reference',
    measures: 'a test reading',
    requestsPerDraw: 1,
    draws,
    readings: [],
    planned: draws.length,
    spreadMs: 0,
  }
}

function choose(n: number, k: number): number {
  let value = 1
  for (let i = 1; i <= k; i += 1) {
    value = (value * (n - k + i)) / i
  }
  return value
}

/** Every arrangement of `ones` ones among `n`, by brute force. */
function arrangements(n: number, ones: number): boolean[][] {
  if (n === 0) {
    return ones === 0 ? [[]] : []
  }
  const withOne = ones > 0 ? arrangements(n - 1, ones - 1).map((rest) => [true, ...rest]) : []
  const withZero = ones < n ? arrangements(n - 1, ones).map((rest) => [false, ...rest]) : []
  return [...withOne, ...withZero]
}

describe('exact bounds', () => {
  it('reproduces the c table of docs/scoring.md', () => {
    const table: [number, number][] = [
      [5, 0.451],
      [10, 0.259],
      [12, 0.221],
      [30, 0.095],
      [120, 0.025],
      [200, 0.015],
    ]
    for (const [n, c] of table) {
      expect(exactUpper(0, n)).toBeCloseTo(c, 3)
      expect(exactUpper(0, n)).toBeCloseTo(1 - 0.05 ** (1 / n), 12)
    }
  })

  it('finds the p at which x or fewer has probability 5%', () => {
    const p = exactUpper(1, 31)
    const cdf = (1 - p) ** 31 + 31 * p * (1 - p) ** 30
    expect(cdf).toBeCloseTo(0.05, 9)
    expect(exactUpper(31, 31)).toBe(1)
  })

  it('prints the widened bounds the doc promises for lost draws', () => {
    expect(epsilonInterval(0, 30, 0)[1]).toBeCloseTo(0.095, 3)
    expect(epsilonInterval(0, 30, 1)[1]).toBeCloseTo(0.144, 3)
    expect(epsilonInterval(0, 30, 3)[1]).toBeCloseTo(0.219, 3)
    // Not Wilson's figure: the printed bound must reduce to c when nothing is lost.
    expect(wilsonUpper(1, 31)).toBeCloseTo(0.162, 3)
  })

  it('mirrors the bound when every readable draw disagrees', () => {
    const [low, high] = epsilonInterval(30, 30, 1)
    expect(high).toBe(1)
    expect(low).toBeCloseTo(1 - exactUpper(1, 31), 12)
  })

  it('uses Wilson at both ends for a mixture, pushed out by the lost draws', () => {
    const [low, high] = epsilonInterval(9, 30, 2)
    expect(low).toBeCloseTo(wilsonLower(9, 32), 12)
    expect(high).toBeCloseTo(wilsonUpper(11, 32), 12)
    expect(low).toBeLessThan(9 / 30)
    expect(high).toBeGreaterThan(9 / 30)
  })

  it('says nothing when nothing could be read', () => {
    expect(epsilonInterval(0, 0, 4)).toEqual([0, 1])
  })

  it('keeps Wilson inside [0, 1]', () => {
    expect(wilsonLower(0, 3)).toBe(0)
    expect(wilsonUpper(3, 3)).toBe(1)
  })
})

describe('runs test', () => {
  it('counts blocks of equal outcomes', () => {
    expect(runsIn([])).toBe(0)
    expect(runsIn([true, true, false, true])).toBe(3)
    expect(runsIn([false, true, false, true])).toBe(4)
  })

  it('matches brute-force enumeration', () => {
    for (const [n, ones] of [
      [6, 2],
      [7, 3],
      [8, 4],
      [9, 1],
    ] as const) {
      const all = arrangements(n, ones)
      expect(all).toHaveLength(choose(n, ones))
      for (let r = 1; r <= n; r += 1) {
        const share = all.filter((sequence) => runsIn(sequence) <= r).length / all.length
        expect(fewRunsProbability(r, ones, n - ones)).toBeCloseTo(share, 12)
      }
    }
  })

  it('gives n / C(n, d) for three runs or fewer', () => {
    expect(fewRunsProbability(3, 9, 21)).toBeCloseTo(30 / choose(30, 9), 15)
    expect(fewRunsProbability(3, 9, 21)).toBeLessThan(3e-6)
  })

  it('has nothing to test without both outcomes', () => {
    expect(fewRunsProbability(1, 0, 10)).toBe(1)
  })
})

describe('epsilonOf', () => {
  it('bounds a clean run, and reads it as uniform', () => {
    const epsilon = epsilonOf(run('a'.repeat(30)))
    expect(epsilon).toMatchObject({ disagreements: 0, trials: 30, lost: 0, estimate: 0 })
    expect(epsilon.clustered).toBe(false)
    expect(epsilon.interval[1]).toBeCloseTo(0.095, 3)
    expect(consistencyOf(epsilon)).toBe('uniform')
  })

  it('reads a mixture as fractional, and a blocked one as clustered', () => {
    const scattered = epsilonOf(run('aadaaadaaaadaaadaaadaaadaaadaa'))
    expect(consistencyOf(scattered)).toBe('fractional')
    expect(scattered.clustered).toBe(false)

    const blocked = epsilonOf(run(`${'a'.repeat(21)}${'d'.repeat(9)}`))
    expect(blocked.estimate).toBeCloseTo(0.3, 12)
    expect(blocked.clustered).toBe(true)
  })

  it('reads every draw disagreeing as uniform: one backend, not the claimed one', () => {
    expect(consistencyOf(epsilonOf(run('d'.repeat(12))))).toBe('uniform')
  })

  it('leaves out excluded draws, and widens for lost ones', () => {
    const epsilon = epsilonOf(run(`${'a'.repeat(29)}xla`))
    expect(epsilon).toMatchObject({ trials: 30, lost: 1, disagreements: 0 })
    expect(epsilon.interval[1]).toBeCloseTo(0.144, 3)
    expect(lostShare(epsilon)).toBeCloseTo(1 / 31, 12)
    expect(epsilon.draws).toHaveLength(32)
  })

  it('reads too few draws as unknown', () => {
    expect(consistencyOf(epsilonOf(run('adaa')))).toBe('unknown')
    expect(consistencyOf(null)).toBe('unknown')
    expect(epsilonOf(run('ll')).estimate).toBeNull()
    expect(lostShare(null)).toBe(0)
    expect(lostShare(epsilonOf(run('')))).toBe(0)
  })
})
