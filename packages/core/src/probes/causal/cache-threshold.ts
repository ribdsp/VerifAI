/**
 * Whether caching starts where the claimed model's documented minimum says it
 * does. Anthropic publishes a minimum cacheable prompt length per model and
 * says a shorter prompt marked for caching is processed without caching and
 * without an error. The minimums differ between models, so the length at
 * which caching starts is a property of the model behind the endpoint.
 *
 * Two prompts are marked for caching: one well above the claimed minimum and
 * one below it, sized from how many tokens the first turned out to be. The
 * first must be cached before the second is sent. A cached prompt under the
 * minimum is not the claimed model's cache; when a cheaper Anthropic model
 * starts caching lower, that is said too.
 *
 * Each rung writes the cache, which Anthropic bills at 1.25 times the base
 * input price.
 */

import { type AnthropicModel, cheaperAnthropicModels, type Fact } from '@verifai/fingerprints'
import { ProbeNotApplicable } from '../../runner/errors.js'
import {
  ANTHROPIC_CACHE_BELOW_MINIMUM,
  ANTHROPIC_CACHE_EVERY_PLATFORM,
  ANTHROPIC_CACHE_NOT_CACHED,
} from '../../sources/anthropic-causal.js'
import type { Calibration, Probe, ProbeContext, ProbeTarget, Signal } from '../types.js'
import {
  aboveBytes,
  type CacheReading,
  cacheAbove,
  cacheReading,
  cacheRequest,
  cacheText,
  causalSignal,
  claimedAnthropic,
  LARGEST_CACHE_MINIMUM,
  rungTokens,
  weakest,
} from './shared.js'

const ID = 'causal/cache-threshold'

/** The upper rung must be at least this far above the minimum to be judged. */
const ABOVE_FACTOR = 1.1
/** The lower rung aims this far below the minimum, */
const BELOW_TARGET = 0.72
/** and is judged only if it lands at or under this. */
const BELOW_FACTOR = 0.9

const BELOW_BYTES_BOUND = Math.floor(
  (aboveBytes(LARGEST_CACHE_MINIMUM) * BELOW_TARGET) / ABOVE_FACTOR,
)

function usageText(reading: CacheReading): string {
  return `${reading.total} prompt tokens, cache_creation_input_tokens ${reading.written}, cache_read_input_tokens ${reading.read}`
}

/** Whether `model`'s minimum is compatible with caching at `cached` and not at `uncached`. */
function startsBetween(model: AnthropicModel, uncached: number, cached: number): boolean {
  const minimum = model.cacheMinimumTokens?.value
  return minimum !== undefined && minimum > uncached && minimum <= cached
}

interface Rungs {
  readonly fact: Fact<number>
  readonly calibration: Calibration
  readonly cheaper: readonly AnthropicModel[]
  readonly upper: CacheReading
  readonly lower: CacheReading
}

function expectedFor(minimum: number): string {
  return `Prompts of ${minimum} tokens or more marked for caching are cached; shorter ones are processed without caching.`
}

function observedFor({ fact, upper, lower }: Rungs): string {
  return `Above the claimed minimum of ${fact.value}: ${usageText(upper)}. Below it: ${usageText(lower)}.`
}

function belowCached(rungs: Rungs): Signal {
  const { fact, lower } = rungs
  const lowerCheaper = rungs.cheaper.some((other) => startsBetween(other, 0, lower.total))
  return causalSignal(ID, {
    signalId: 'below-cached',
    calibration: rungs.calibration,
    observed: observedFor(rungs),
    expected: expectedFor(fact.value),
    llr: {
      identity: {
        'matches-claim': -1,
        ...(lowerCheaper ? { 'same-vendor-cheaper': 0.5 } : {}),
      },
    },
    plainLanguage: `A prompt shorter than the claimed model can cache was marked for caching and was cached. Anthropic's API never caches a prompt under the model's minimum, so the cache that answered is not the claimed model's${lowerCheaper ? '. A cheaper Anthropic model caches prompts this short' : ''}.`,
    citations: [fact.sources[0], ANTHROPIC_CACHE_BELOW_MINIMUM, ANTHROPIC_CACHE_EVERY_PLATFORM],
  })
}

function thresholdMatches(rungs: Rungs): Signal {
  const { fact, cheaper, upper, lower } = rungs
  const compatible = cheaper.filter((other) => startsBetween(other, lower.total, upper.total))
  const excluded = cheaper.length > 0 && compatible.length === 0
  const someExcluded = compatible.length > 0 && compatible.length < cheaper.length
  const cheaperLlr = excluded ? -0.6 : someExcluded ? -0.3 : undefined
  return causalSignal(ID, {
    signalId: 'threshold-matches',
    calibration: rungs.calibration,
    observed: observedFor(rungs),
    expected: expectedFor(fact.value),
    llr: {
      identity: {
        'matches-claim': 0.2,
        ...(cheaperLlr === undefined ? {} : { 'same-vendor-cheaper': cheaperLlr }),
      },
    },
    plainLanguage: `A prompt above the claimed model's caching minimum was cached and one below it was not, as Anthropic documents for the claimed model.${excluded ? ' No cheaper Anthropic model starts caching between those two lengths.' : ''}`,
    citations: [fact.sources[0], ANTHROPIC_CACHE_BELOW_MINIMUM, ANTHROPIC_CACHE_NOT_CACHED],
  })
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const model = claimedAnthropic(context.target)
  const fact = model?.cacheMinimumTokens
  if (model === undefined || fact === undefined) {
    throw new ProbeNotApplicable('No cache minimum is documented for the claimed model.')
  }
  const minimum = fact.value
  const calibration = weakest('documented', fact.calibration)

  const above = await cacheAbove(context, minimum)
  const upper = cacheReading(above.exchange)
  if (upper === undefined || upper.total < ABOVE_FACTOR * minimum) {
    return []
  }
  if (!upper.cached) {
    return [
      causalSignal(ID, {
        signalId: 'above-not-cached',
        calibration,
        observed: `A prompt marked for caching, above the claimed minimum of ${minimum}: ${usageText(upper)}.`,
        expected: expectedFor(minimum),
        llr: { identity: { 'matches-claim': -0.3 }, translation: { translated: 0.3 } },
        plainLanguage:
          'A prompt long enough for the claimed model to cache was marked for caching and was not cached. Anthropic applies the same minimum on every platform, so something between you and the model removed the cache marker, or the model that answered needs a longer prompt before it caches.',
        citations: [fact.sources[0], ANTHROPIC_CACHE_NOT_CACHED, ANTHROPIC_CACHE_EVERY_PLATFORM],
      }),
    ]
  }

  const belowBytes = Math.floor((BELOW_TARGET * minimum * above.bytes) / upper.total)
  const below = await context.send(
    cacheRequest(context.target, cacheText(context.nonce, 'C', belowBytes)),
  )
  const lower = cacheReading(below)
  if (lower === undefined || lower.total > BELOW_FACTOR * minimum) {
    return []
  }
  const rungs: Rungs = {
    fact,
    calibration,
    cheaper: cheaperAnthropicModels(model.id),
    upper,
    lower,
  }
  return [lower.cached ? belowCached(rungs) : thresholdMatches(rungs)]
}

function applies(target: ProbeTarget): boolean {
  return claimedAnthropic(target)?.cacheMinimumTokens !== undefined
}

export const cacheThreshold: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Prompt caching starts at the documented minimum',
  group: 'D',
  protocols: ['anthropic-messages'],
  vendors: ['anthropic'],
  applies,
  needsKey: true,
  cost: {
    requests: 2,
    tokens: rungTokens(aboveBytes(LARGEST_CACHE_MINIMUM)) + rungTokens(BELOW_BYTES_BOUND),
  },
  citations: [
    ANTHROPIC_CACHE_BELOW_MINIMUM,
    ANTHROPIC_CACHE_NOT_CACHED,
    ANTHROPIC_CACHE_EVERY_PLATFORM,
  ],
  run,
})
