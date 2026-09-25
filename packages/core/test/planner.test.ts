import { describe, expect, it } from 'vitest'
import { type PlanOptions, planProbes, probeCost } from '../src/planner/plan.js'
import { DEFAULT_DRAWS, MAX_SPREAD_MS, PARANOID_SPREAD_MS } from '../src/planner/profiles.js'
import { seededShuffle } from '../src/planner/shuffle.js'
import type { AnyProbe, Probe, ProbeGroup } from '../src/probes/types.js'
import { probeTarget } from './fakes/context.js'
import { DILUTION_ID, testDilutionProbe, testProbe } from './fakes/probes.js'

interface Shape {
  readonly group?: Exclude<ProbeGroup, 'F'>
  readonly requests?: number
  readonly tokens?: number
  readonly needsKey?: boolean
  readonly optIn?: boolean
  readonly protocols?: Probe['protocols']
  readonly vendors?: Probe['vendors']
  readonly applies?: Probe['applies']
}

function probe(id: string, shape: Shape = {}): Probe {
  const base = testProbe(id, { group: shape.group ?? 'A' })
  return Object.freeze({
    ...base,
    needsKey: shape.needsKey ?? false,
    cost: { requests: shape.requests ?? 1, tokens: shape.tokens ?? 0 },
    ...(shape.optIn === undefined ? {} : { optIn: shape.optIn }),
    ...(shape.protocols === undefined ? {} : { protocols: shape.protocols }),
    ...(shape.vendors === undefined ? {} : { vendors: shape.vendors }),
    ...(shape.applies === undefined ? {} : { applies: shape.applies }),
  })
}

const DILUTION = testDilutionProbe({ requestsPerDraw: 2 })

function plan(catalogue: readonly AnyProbe[], overrides: Partial<PlanOptions> = {}) {
  return planProbes({
    target: probeTarget(),
    profile: 'standard',
    hasKey: true,
    catalogue,
    dilutionSupported: true,
    orderSeed: 'seed1234',
    ...overrides,
  })
}

const ids = (probes: readonly AnyProbe[]) => probes.map((entry) => entry.id)

describe('probeCost', () => {
  it('takes a probe at its word and multiplies a Group F draw', () => {
    expect(probeCost(probe('a/one', { requests: 3, tokens: 40 }), 30)).toEqual({
      requests: 3,
      tokens: 40,
    })
    // 30 draws, 3 replacements, 1 preparation.
    expect(probeCost(DILUTION, 30)).toEqual({ requests: 68, tokens: 0 })
  })
})

describe('planProbes', () => {
  it("keeps the profile's groups that apply, in catalogue order, F last", () => {
    const catalogue = [
      DILUTION,
      probe('a/one'),
      probe('d/causal', { group: 'D' }),
      probe('b/count', { group: 'B' }),
      probe('a/openai-only', { protocols: ['openai-chat'] }),
      probe('a/gpt-claims', { vendors: ['openai'] }),
      probe('a/never', { applies: () => false }),
      probe('c/tokens', { group: 'C' }),
    ]
    const result = plan(catalogue)

    expect(ids(result.probes)).toEqual(['a/one', 'b/count', 'c/tokens', DILUTION_ID])
    expect(result.skipped).toEqual([])
    expect(result.outcomes).toEqual([])
    expect(result).toMatchObject({
      profile: 'standard',
      requests: 71,
      tokens: 0,
      maxRequests: 400,
      maxTokens: 40_000,
      draws: DEFAULT_DRAWS,
      spreadMs: 0,
      shuffled: false,
      budgetLimited: false,
      dilutionUnsupported: false,
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.probes)).toBe(true)
  })

  it('records what should have run and will not, with why', () => {
    const catalogue = [
      probe('a/free'),
      probe('b/keyed', { group: 'B', needsKey: true }),
      probe('a/opt', { optIn: true }),
      DILUTION,
    ]
    const result = plan(catalogue, { hasKey: false, dilutionSupported: false })

    expect(ids(result.probes)).toEqual(['a/free'])
    expect(result.skipped).toEqual([
      { probeId: 'b/keyed', reason: 'needs-api-key' },
      { probeId: 'a/opt', reason: 'opt-in' },
      { probeId: DILUTION_ID, reason: 'unsupported-by-transport' },
    ])
    expect(result.outcomes).toEqual([
      { probeId: 'b/keyed', group: 'B', status: 'skipped', reason: 'needs-api-key' },
      { probeId: 'a/opt', group: 'A', status: 'skipped', reason: 'opt-in' },
      { probeId: DILUTION_ID, group: 'F', status: 'skipped', reason: 'unsupported-by-transport' },
    ])
    expect(result).toMatchObject({ draws: 0, spreadMs: 0, dilutionUnsupported: true })
  })

  it('runs an opt-in probe the buyer names', () => {
    const result = plan([probe('a/opt', { optIn: true })], { optIn: ['a/opt'] })
    expect(ids(result.probes)).toEqual(['a/opt'])
  })

  it('admits in priority order while the budget lasts, and keeps looking', () => {
    const catalogue = [
      probe('a/one', { requests: 2, tokens: 10 }),
      probe('b/dear', { group: 'B', requests: 1, tokens: 500 }),
      probe('c/cheap', { group: 'C', requests: 1, tokens: 10 }),
      probe('c/many', { group: 'C', requests: 5 }),
    ]
    const result = plan(catalogue, { maxRequests: 5, maxTokens: 100 })

    expect(ids(result.probes)).toEqual(['a/one', 'c/cheap'])
    expect(result.skipped).toEqual([
      { probeId: 'b/dear', reason: 'budget-exceeded' },
      { probeId: 'c/many', reason: 'budget-exceeded' },
    ])
    expect(result).toMatchObject({ requests: 3, tokens: 20, budgetLimited: true })
  })

  it('reads a zero token budget as zero, not as the default', () => {
    const result = plan([probe('a/free'), probe('b/spends', { group: 'B', tokens: 1 })], {
      maxTokens: 0,
    })
    expect(ids(result.probes)).toEqual(['a/free'])
    expect(result.maxTokens).toBe(0)
  })

  it('leaves Group F out of profiles without it', () => {
    const result = plan([probe('a/one'), probe('b/count', { group: 'B' }), DILUTION], {
      profile: 'quick',
    })
    expect(ids(result.probes)).toEqual(['a/one'])
    expect(result).toMatchObject({ draws: 0, maxRequests: 120, maxTokens: 5_000 })
  })

  it('shuffles paranoid runs by the seed, and only them', () => {
    const catalogue = [
      ...Array.from({ length: 12 }, (_unused, index) => probe(`a/p${index}`)),
      DILUTION,
    ]
    const first = plan(catalogue, { profile: 'paranoid', orderSeed: 'seed1234' })
    const again = plan(catalogue, { profile: 'paranoid', orderSeed: 'seed1234' })
    const other = plan(catalogue, { profile: 'paranoid', orderSeed: 'seed5678' })

    expect(ids(first.probes)).toEqual(ids(again.probes))
    expect(ids(first.probes)).not.toEqual(ids(other.probes))
    expect(ids(first.probes)).not.toEqual(ids(catalogue))
    expect(first.probes.at(-1)?.id).toBe(DILUTION_ID)
    expect([...ids(first.probes)].sort()).toEqual([...ids(catalogue)].sort())
    expect(first).toMatchObject({ shuffled: true, spreadMs: PARANOID_SPREAD_MS })
    expect(ids(plan(catalogue, { profile: 'deep' }).probes)).toEqual(ids(catalogue))
  })

  it('takes the spread the buyer sets', () => {
    expect(plan([DILUTION], { spreadMs: 60_000 }).spreadMs).toBe(60_000)
  })

  it.each([
    { maxRequests: 0 },
    { maxRequests: 2001 },
    { maxRequests: 1.5 },
    { maxTokens: -1 },
    { maxTokens: 2_000_001 },
    { spreadMs: MAX_SPREAD_MS + 1 },
    { spreadMs: Number.NaN },
    { orderSeed: 'short' },
    { orderSeed: 'UPPERCASE1' },
  ])('refuses %o', (overrides) => {
    expect(() => plan([probe('a/one')], overrides)).toThrow(TypeError)
  })

  it('refuses a catalogue that lists a probe twice or two Group F probes', () => {
    expect(() => plan([probe('a/one'), probe('a/one')])).toThrow(TypeError)
    const twin = Object.freeze({ ...DILUTION, id: 'dilution/twin' })
    expect(() => plan([DILUTION, twin])).toThrow(TypeError)
  })

  it('refuses a profile it does not know', () => {
    expect(() => plan([], { profile: 'reckless' as never })).toThrow(TypeError)
  })
})

describe('seededShuffle', () => {
  it('returns a new permutation and leaves the input alone', () => {
    const items = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8])
    const shuffled = seededShuffle(items, 'abcdefgh')
    expect([...shuffled].sort()).toEqual([...items])
    expect(shuffled).not.toBe(items)
    expect(seededShuffle([], 'abcdefgh')).toEqual([])
  })
})
