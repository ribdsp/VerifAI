import { describe, expect, it } from 'vitest'
import { planProbes } from '../src/planner/plan.js'
import { PROFILES } from '../src/planner/profiles.js'
import { PROBE_CATALOGUE } from '../src/probes/registry.js'
import { isDilutionProbe, PROBE_GROUPS } from '../src/probes/types.js'
import { PROTOCOLS, VENDORS } from '../src/types/target.js'
import { probeTarget } from './fakes/context.js'

const MODELS = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  openai: ['gpt-5', 'gpt-4o', 'gpt-6-astra'],
} as const

const TARGETS = PROTOCOLS.values.flatMap((protocol) =>
  VENDORS.values.flatMap((vendor) =>
    MODELS[vendor].map((model) => probeTarget({ protocol, vendor, model })),
  ),
)

describe('PROBE_CATALOGUE', () => {
  it('lists each probe once, frozen, grouped from A to F', () => {
    const ids = PROBE_CATALOGUE.map((probe) => probe.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(PROBE_CATALOGUE.every((probe) => Object.isFrozen(probe))).toBe(true)
    const ranks = PROBE_CATALOGUE.map((probe) => PROBE_GROUPS.values.indexOf(probe.group))
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right))
    expect(PROBE_CATALOGUE.filter(isDilutionProbe)).toHaveLength(1)
  })

  it('covers every group for a native pairing, and accounting and dilution for any', () => {
    for (const target of TARGETS) {
      const plan = planProbes({
        target,
        profile: 'deep',
        hasKey: true,
        catalogue: PROBE_CATALOGUE,
        dilutionSupported: true,
        orderSeed: 'seed1234',
      })
      const groups = [...new Set(plan.probes.map((probe) => probe.group))].sort()
      // No tokenizer is published for GPT-6, so Group C has nothing to compare against.
      const tokenizer = target.claimedModel.startsWith('gpt-6') ? [] : ['C']
      const expected = target.pairing === 'native' ? ['A', 'B', ...tokenizer, 'D', 'F'] : ['B', 'F']
      expect(groups, `${target.protocol} ${target.claimedModel}`).toEqual(
        expect.arrayContaining(expected),
      )
    }
  })

  it.each(PROFILES.values)("fits every applicable probe into %s's default budget", (profile) => {
    for (const target of TARGETS) {
      const plan = planProbes({
        target,
        profile,
        hasKey: true,
        catalogue: PROBE_CATALOGUE,
        dilutionSupported: true,
        orderSeed: 'seed1234',
      })
      expect(
        plan.skipped,
        `${profile} ${target.protocol} ${target.claimedModel}: ${plan.requests} requests, ${plan.tokens} tokens`,
      ).toEqual([])
    }
  })
})
