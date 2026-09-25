import { describe, expect, it } from 'vitest'
import { ANTHROPIC_CONFORMANCE_PROBES } from '../../../../src/probes/conformance/anthropic/index.js'
import { PROMPT } from '../../../../src/probes/conformance/anthropic/shared.js'

const SELF_IDENTIFICATION = /what model are you|which model are you|who are you|identify yourself/i

describe('ANTHROPIC_CONFORMANCE_PROBES', () => {
  it('is a frozen list of frozen Group A probes, each named after its module', () => {
    expect(Object.isFrozen(ANTHROPIC_CONFORMANCE_PROBES)).toBe(true)
    expect(ANTHROPIC_CONFORMANCE_PROBES.map((probe) => probe.id)).toEqual([
      'conformance/anthropic/error-envelope',
      'conformance/anthropic/error-vocabulary',
      'conformance/anthropic/extra-inputs',
      'conformance/anthropic/beta-header',
      'conformance/anthropic/missing-max-tokens',
      'conformance/anthropic/model-retrieve',
      'conformance/anthropic/sampling-matrix',
      'conformance/anthropic/assistant-prefill',
      'conformance/anthropic/thinking-matrix',
      'conformance/anthropic/forced-tool-choice',
    ])
    for (const probe of ANTHROPIC_CONFORMANCE_PROBES) {
      expect(Object.isFrozen(probe)).toBe(true)
      expect(probe.group).toBe('A')
      expect(probe.vendors).toEqual(['anthropic'])
      expect(probe.protocols).toEqual(['anthropic-messages'])
      expect(probe.citations.length).toBeGreaterThan(0)
      expect(probe.needsKey).toBe(true)
    }
  })

  it('spends tokens only where a request can generate', () => {
    const tokenFree = ANTHROPIC_CONFORMANCE_PROBES.filter((probe) => probe.cost.tokens === 0)

    expect(tokenFree.map((probe) => probe.id)).toEqual([
      'conformance/anthropic/error-envelope',
      'conformance/anthropic/error-vocabulary',
      'conformance/anthropic/model-retrieve',
    ])
  })

  it('never asks a model who it is', () => {
    expect(SELF_IDENTIFICATION.test(PROMPT)).toBe(false)
  })
})
