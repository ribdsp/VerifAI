import { describe, expect, it } from 'vitest'
import { TINY_PROMPT } from '../../../../src/probes/conformance/common/shared.js'
import { OPENAI_CONFORMANCE_PROBES } from '../../../../src/probes/conformance/openai/index.js'

const SELF_IDENTIFICATION = /what model are you|which model are you|who are you|identify yourself/i

describe('OPENAI_CONFORMANCE_PROBES', () => {
  it('is a frozen list of frozen Group A probes, each named after its module', () => {
    expect(Object.isFrozen(OPENAI_CONFORMANCE_PROBES)).toBe(true)
    expect(OPENAI_CONFORMANCE_PROBES.map((probe) => probe.id)).toEqual([
      'conformance/openai/route-serializers',
      'conformance/openai/proxy-wasm-header',
      'conformance/openai/empty-404',
      'conformance/openai/cors',
      'conformance/openai/auth-only-headers',
      'conformance/openai/unknown-parameter',
      'conformance/openai/model-not-found',
      'conformance/openai/temperature-above-max',
      'conformance/openai/reasoning-matrix',
    ])
    for (const probe of OPENAI_CONFORMANCE_PROBES) {
      expect(Object.isFrozen(probe)).toBe(true)
      expect(probe.group).toBe('A')
      expect(probe.vendors).toEqual(['openai'])
      expect(probe.protocols).toEqual(['openai-chat', 'openai-responses'])
      expect(probe.citations.length).toBeGreaterThan(0)
    }
  })

  it('spends no tokens without a key and almost none per request with one', () => {
    const keyless = OPENAI_CONFORMANCE_PROBES.filter((probe) => !probe.needsKey)
    expect(keyless.map((probe) => probe.cost.tokens)).toEqual(keyless.map(() => 0))
    for (const probe of OPENAI_CONFORMANCE_PROBES) {
      expect(probe.cost.tokens).toBeLessThanOrEqual(128 * probe.cost.requests)
      expect(probe.cost.requests).toBeLessThanOrEqual(4)
    }
  })

  it('never asks a model who it is', () => {
    expect(SELF_IDENTIFICATION.test(TINY_PROMPT)).toBe(false)
  })
})
