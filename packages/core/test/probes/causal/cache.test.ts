import { anthropicModel } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { cacheInvalidation } from '../../../src/probes/causal/cache-invalidation.js'
import { cacheThreshold } from '../../../src/probes/causal/cache-threshold.js'
import type { Exchange, ProbeRequest } from '../../../src/probes/types.js'
import { ProbeLost, ProbeNotApplicable } from '../../../src/runner/errors.js'
import { ANTHROPIC_CACHE_IDENTICAL_PREFIX } from '../../../src/sources/anthropic-causal.js'
import { exchange, inOrder, probeContext, probeTarget } from '../../fakes/context.js'
import { bodyOf, cached, cachedTextOf, message, withinCost } from './replies.js'

// biome-ignore lint/style/useNamingConvention: Anthropic's wire names.
const NO_CACHE_FIELDS = message({ usage: { input_tokens: 905, output_tokens: 1 } })

async function threshold(model: string, ...answers: readonly Exchange[]) {
  const fake = probeContext(inOrder(...answers), { model })
  const signals = await cacheThreshold.run(fake.context)
  expect(withinCost(cacheThreshold, fake)).toBe(true)
  return { fake, signals }
}

async function invalidation(...answers: readonly Exchange[]) {
  const fake = probeContext(inOrder(...answers))
  const signals = await cacheInvalidation.run(fake.context)
  expect(withinCost(cacheInvalidation, fake)).toBe(true)
  return { fake, signals }
}

function isMarked(request: ProbeRequest | undefined): boolean {
  const messages = bodyOf(request).messages as { content: Record<string, unknown>[] }[]
  return JSON.stringify(messages[0]?.content[0]?.cache_control) === '{"type":"ephemeral"}'
}

describe('causal/cache-threshold', () => {
  it('finds caching starting between the rungs, and no cheaper model starting there', async () => {
    const { fake, signals } = await threshold(
      'claude-opus-5-5',
      cached(5, 0, 900),
      cached(380, 0, 0),
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      probeId: 'causal/cache-threshold',
      signalId: 'threshold-matches',
      calibration: 'documented',
      llr: { identity: { 'matches-claim': 0.2, 'same-vendor-cheaper': -0.6 } },
    })
    expect(signals[0]?.citations[0]).toBe(
      anthropicModel('claude-opus-5-5')?.cacheMinimumTokens?.sources[0],
    )
    const [upper, lower] = fake.requests.map((request) => (request ? cachedTextOf(request) : ''))
    expect(fake.requests.every(isMarked)).toBe(true)
    expect(upper?.startsWith('A n0nce7test ')).toBe(true)
    expect(lower?.startsWith('C n0nce7test ')).toBe(true)
    // 0.72 of the 512 minimum, at the upper rung's bytes per token.
    const upperBytes = new TextEncoder().encode(upper).length
    expect(new TextEncoder().encode(lower).length).toBeLessThanOrEqual(
      Math.floor((0.72 * 512 * 4608) / 905),
    )
    expect(upperBytes).toBeLessThanOrEqual(4608)
  })

  it('weakens the case against cheaper models when only some are ruled out', async () => {
    const { signals } = await threshold('claude-opus-4-7', cached(10, 0, 4190), cached(1500, 0, 0))

    expect(signals[0]?.llr.identity).toEqual({ 'matches-claim': 0.2, 'same-vendor-cheaper': -0.3 })
  })

  it('says nothing of cheaper models when there are none', async () => {
    const { signals } = await threshold(
      'claude-haiku-4-5-20251001',
      cached(10, 0, 5000),
      cached(3000, 0, 0),
    )

    expect(signals[0]?.llr.identity).toEqual({ 'matches-claim': 0.2 })
    expect(signals[0]?.plainLanguage).not.toContain('cheaper')
  })

  it('finds a prompt under the minimum cached, and a cheaper model that caches it', async () => {
    const { signals } = await threshold('claude-opus-4-7', cached(10, 0, 3600), cached(10, 0, 1390))

    expect(signals[0]).toMatchObject({
      signalId: 'below-cached',
      llr: { identity: { 'matches-claim': -1, 'same-vendor-cheaper': 0.5 } },
    })
  })

  it('finds a prompt under the minimum cached with no cheaper model to name', async () => {
    const { signals } = await threshold('claude-opus-5-5', cached(5, 0, 900), cached(0, 0, 380))

    expect(signals[0]?.signalId).toBe('below-cached')
    expect(signals[0]?.llr.identity).toEqual({ 'matches-claim': -1 })
  })

  it('reads a long prompt left uncached as a layer or a model with a higher minimum', async () => {
    const { fake, signals } = await threshold('claude-opus-5-5', cached(905, 0, 0))

    expect(fake.requests).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'above-not-cached',
      llr: { identity: { 'matches-claim': -0.3 }, translation: { translated: 0.3 } },
    })
  })

  it.each([
    ['fails', exchange(500, 'upstream failed')],
    ['carries no cache fields', NO_CACHE_FIELDS],
    ['comes out too short to be above the minimum', cached(500, 0, 0)],
  ])('stops when the upper rung %s', async (_label, answer) => {
    const { fake, signals } = await threshold('claude-opus-5-5', answer)

    expect(fake.requests).toHaveLength(1)
    expect(signals).toEqual([])
  })

  it.each([
    ['fails', exchange(500, 'upstream failed')],
    ['comes out too long to be below the minimum', cached(470, 0, 0)],
  ])('judges nothing when the lower rung %s', async (_label, answer) => {
    const { signals } = await threshold('claude-opus-5-5', cached(5, 0, 900), answer)

    expect(signals).toEqual([])
  })

  it('is not applicable without a documented minimum', async () => {
    const fake = probeContext(inOrder(cached(5, 0, 900)), { model: 'claude-unknown-9' })

    expect(cacheThreshold.applies?.(fake.context.target)).toBe(false)
    await expect(cacheThreshold.run(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
    expect(cacheThreshold.applies?.(probeTarget())).toBe(true)
  })
})

describe('causal/cache-invalidation', () => {
  it('reads cache reads after the first character changed as figures not from a prefix cache', async () => {
    const { fake, signals } = await invalidation(
      cached(5, 0, 900),
      cached(5, 900, 0),
      cached(5, 900, 0),
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      probeId: 'causal/cache-invalidation',
      signalId: 'changed-prefix-hit',
      calibration: 'documented',
      llr: { identity: { 'matches-claim': -0.5 }, translation: { translated: 0.8 } },
    })
    expect(signals[0]?.citations).toEqual([ANTHROPIC_CACHE_IDENTICAL_PREFIX])
    const [first, repeat, changed] = fake.requests.map((request) =>
      request ? cachedTextOf(request) : '',
    )
    expect(repeat).toBe(first)
    expect(changed).toBe(`B${first?.slice(1)}`)
  })

  it('finds a miss when the changed prompt is written afresh', async () => {
    const { signals } = await invalidation(cached(5, 0, 900), cached(5, 900, 0), cached(5, 0, 900))

    expect(signals[0]).toMatchObject({ signalId: 'changed-prefix-miss', llr: {} })
  })

  it('does not take a cached prefix of its own plus a fresh write for a hit', async () => {
    const { signals } = await invalidation(
      cached(5, 0, 900),
      cached(5, 900, 0),
      cached(5, 900, 900),
    )

    expect(signals[0]?.signalId).toBe('changed-prefix-miss')
  })

  it.each([
    ['was not cached', [cached(905, 0, 0)], 1],
    ['carried no cache fields', [NO_CACHE_FIELDS], 1],
    ['read nothing more when repeated', [cached(5, 0, 900), cached(5, 0, 900)], 2],
    ['failed when repeated', [cached(5, 0, 900), exchange(500)], 2],
    ['failed once changed', [cached(5, 0, 900), cached(5, 900, 0), exchange(500)], 3],
  ])('judges nothing when the prompt %s', async (_label, answers, sent) => {
    const { fake, signals } = await invalidation(...answers)

    expect(fake.requests).toHaveLength(sent)
    expect(signals).toEqual([])
  })

  it('reuses the upper rung of causal/cache-threshold', async () => {
    const fake = probeContext((request) => {
      const text = cachedTextOf(request)
      if (text.startsWith('C')) {
        return cached(380, 0, 0)
      }
      if (text.startsWith('B')) {
        return cached(5, 0, 900)
      }
      return fake.requests.length === 1 ? cached(5, 0, 900) : cached(5, 900, 0)
    })

    const [found] = await cacheThreshold.run(fake.context)
    const [missed] = await cacheInvalidation.run(fake.context)

    expect(found?.signalId).toBe('threshold-matches')
    expect(missed?.signalId).toBe('changed-prefix-miss')
    expect(fake.requests.map((request) => cachedTextOf(request)[0])).toEqual(['A', 'C', 'A', 'B'])
  })

  it('lets runner errors through', async () => {
    const fake = probeContext(inOrder(new ProbeLost()))

    await expect(cacheInvalidation.run(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })

  it('is not applicable without a documented minimum', async () => {
    const fake = probeContext(inOrder(cached(5, 0, 900)), { protocol: 'openai-chat' })

    expect(cacheInvalidation.applies?.(fake.context.target)).toBe(false)
    await expect(cacheInvalidation.run(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
  })
})
