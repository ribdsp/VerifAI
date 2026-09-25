import { describe, expect, it } from 'vitest'
import { COMMON_CONFORMANCE_PROBES } from '../../../../src/probes/conformance/common/index.js'
import {
  OUT_OF_RANGE_TEMPERATURE,
  TINY_PROMPT,
  TINY_REQUEST_TOKENS,
} from '../../../../src/probes/conformance/common/shared.js'
import { estimateTokens } from '../../../../src/probes/shared.js'

const SELF_IDENTIFICATION = /what model are you|which model are you|who are you|identify yourself/i

describe('COMMON_CONFORMANCE_PROBES', () => {
  it('is a frozen list of frozen Group A probes, each named after its module', () => {
    expect(Object.isFrozen(COMMON_CONFORMANCE_PROBES)).toBe(true)
    expect(COMMON_CONFORMANCE_PROBES.map((probe) => probe.id)).toEqual([
      'conformance/common/permissive-validator',
      'conformance/common/protocol-leakage',
      'conformance/common/compat-fields',
    ])
    for (const probe of COMMON_CONFORMANCE_PROBES) {
      expect(Object.isFrozen(probe)).toBe(true)
      expect(probe.group).toBe('A')
      expect(probe.needsKey).toBe(true)
      expect(probe.cost).toEqual({ requests: 1, tokens: TINY_REQUEST_TOKENS })
      expect(probe.citations.length).toBeGreaterThan(0)
    }
  })

  it('bounds a single-token request by the prompt and the Responses minimum', () => {
    expect(TINY_REQUEST_TOKENS).toBe(estimateTokens(TINY_PROMPT) + 16)
    expect(OUT_OF_RANGE_TEMPERATURE).toBeGreaterThan(2)
  })

  it('never asks a model who it is', () => {
    expect(SELF_IDENTIFICATION.test(TINY_PROMPT)).toBe(false)
  })
})
