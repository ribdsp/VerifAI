import { ANTHROPIC_MODELS, anthropicModel } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { CAUSAL_PROBES } from '../../../src/probes/causal/index.js'
import {
  byteLength,
  cacheReading,
  cacheText,
  displayDefault,
  distinct,
  encodingsFor,
  fnv1a,
  promptTokens,
  thinkingConfig,
  tokenProbeApplies,
  weakest,
} from '../../../src/probes/causal/shared.js'
import { ProbeNotApplicable } from '../../../src/runner/errors.js'
import {
  ANTHROPIC_CACHE_BELOW_MINIMUM,
  ANTHROPIC_CACHE_NOT_CACHED,
} from '../../../src/sources/anthropic-causal.js'
import { exchange, probeTarget } from '../../fakes/context.js'
import { cached, message } from './replies.js'

describe('causal probes', () => {
  it('are the seven Group D modules, each under its own path', () => {
    expect(CAUSAL_PROBES.map((probe) => probe.id)).toEqual([
      'causal/thinking-signature',
      'causal/thinking-display',
      'causal/cache-threshold',
      'causal/cache-invalidation',
      'causal/structured-output',
      'causal/logit-bias',
      'causal/logprobs-retokenize',
    ])
    expect(Object.isFrozen(CAUSAL_PROBES)).toBe(true)
    for (const probe of CAUSAL_PROBES) {
      expect(probe.group).toBe('D')
      expect(probe.needsKey).toBe(true)
      expect(probe.citations.length).toBeGreaterThan(0)
      expect(probe.cost.requests).toBeGreaterThan(0)
      expect(Number.isInteger(probe.cost.tokens)).toBe(true)
    }
  })

  it('never speak to a claim over another vendor protocol', () => {
    const target = probeTarget({
      protocol: 'openai-chat',
      vendor: 'anthropic',
      model: 'claude-opus-5-5',
    })
    const planned = CAUSAL_PROBES.filter(
      (probe) => probe.protocols.includes(target.protocol) && (probe.applies?.(target) ?? true),
    )

    expect(planned).toEqual([])
  })
})

describe('causal/shared', () => {
  it('takes the weakest calibration', () => {
    expect(weakest('measured')).toBe('measured')
    expect(weakest('documented', 'derived', 'measured')).toBe('derived')
    expect(weakest('heuristic', 'documented')).toBe('heuristic')
  })

  it('keeps each citation once, in order, and refuses none', () => {
    expect(
      distinct([
        ANTHROPIC_CACHE_NOT_CACHED,
        ANTHROPIC_CACHE_BELOW_MINIMUM,
        ANTHROPIC_CACHE_NOT_CACHED,
      ]),
    ).toEqual([ANTHROPIC_CACHE_NOT_CACHED, ANTHROPIC_CACHE_BELOW_MINIMUM])
    expect(() => distinct([])).toThrow(TypeError)
  })

  it('counts UTF-8 bytes', () => {
    expect(byteLength(undefined)).toBe(0)
    expect(byteLength('é!')).toBe(3)
  })

  it('hashes with 32-bit FNV-1a', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('a')).toBe(0xe40c292c)
  })

  it('writes cache filler within its size, unique to the nonce and lead', () => {
    const text = cacheText('n0nce7test', 'A', 2000)

    expect(text.startsWith('A n0nce7test ')).toBe(true)
    expect(text.endsWith('Reply with the single word: ok.')).toBe(true)
    expect(byteLength(text)).toBeLessThanOrEqual(2000)
    expect(byteLength(text)).toBeGreaterThan(1980)
    expect(cacheText('n0nce7test', 'A', 2000)).toBe(text)
    expect(cacheText('n0nce7test', 'C', 2000).slice(12, 200)).not.toBe(text.slice(12, 200))
    expect(cacheText('other7nonce', 'A', 2000)).not.toBe(text)
  })

  it('reads cache fields only from a successful response that has them', () => {
    expect(cacheReading(cached(5, 300, 600))).toEqual({
      total: 905,
      read: 300,
      written: 600,
      cached: true,
    })
    expect(cacheReading(cached(905, 0, 0))?.cached).toBe(false)
    expect(cacheReading(exchange(500))).toBeUndefined()
    expect(cacheReading(message())).toBeUndefined()
    // biome-ignore lint/style/useNamingConvention: Anthropic's wire name.
    expect(cacheReading(message({ usage: { output_tokens: 1 } }))).toBeUndefined()
  })

  it('counts no prompt tokens without an input count', () => {
    expect(promptTokens(undefined)).toBeUndefined()
  })

  it('asks for no thinking a model is not recorded to accept', () => {
    const model = anthropicModel('claude-opus-5-5')
    expect(model).toBeDefined()
    if (model === undefined) {
      return
    }
    const silent = {
      ...model,
      rejectsThinkingAdaptive: undefined,
      rejectsThinkingEnabled: undefined,
    }

    expect(thinkingConfig(silent)).toBeUndefined()
  })

  it('knows a display default only where one is documented', () => {
    const known = ANTHROPIC_MODELS.filter((model) => displayDefault(model) !== undefined)

    expect(known.map((model) => model.id)).not.toContain('claude-haiku-4-5-20251001')
    expect(known.every((model) => thinkingConfig(model) !== undefined)).toBe(true)
  })

  it('pairs the claimed encoding with the other local one', () => {
    expect(encodingsFor('gpt-4o')).toMatchObject({ claimed: 'o200k_base', other: 'cl100k_base' })
    expect(encodingsFor('gpt-3.5-turbo')).toMatchObject({
      claimed: 'cl100k_base',
      other: 'o200k_base',
    })
    expect(() => encodingsFor('not-a-model')).toThrow(ProbeNotApplicable)
  })

  it.each([
    ['gpt-4o', true],
    ['chatgpt-4o-latest', true],
    ['gpt-4o-realtime-preview', false],
    ['gpt-4o-search-preview', false],
    ['o4-mini', false],
  ])('treats %s as a token-ID target: %s', (model, expected) => {
    expect(tokenProbeApplies(probeTarget({ protocol: 'openai-chat', model }))).toBe(expected)
  })
})
