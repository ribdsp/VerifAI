/**
 * Whether a cache hit needs the prompt to be identical, as Anthropic's does.
 * Anthropic's cache matches exact prefixes up to the block marked for caching,
 * so changing the first character of a cached prompt leaves nothing of it to
 * read. A report of cache reads after that change was not written by a prefix
 * cache: something between you and the model is producing the usage figures.
 *
 * The cached prompt of `causal/cache-threshold` is sent again unchanged, which
 * must read from the cache before anything is judged, and then with its first
 * character changed. A genuine miss writes the changed prompt afresh, which
 * tells a miss apart from a prefix a layer injects and caches on its own.
 */

import { ProbeNotApplicable } from '../../runner/errors.js'
import { ANTHROPIC_CACHE_IDENTICAL_PREFIX } from '../../sources/anthropic-causal.js'
import type { Probe, ProbeContext, ProbeTarget, Signal } from '../types.js'
import {
  aboveBytes,
  type CacheReading,
  cacheAbove,
  cacheReading,
  cacheRequest,
  causalSignal,
  claimedAnthropic,
  LARGEST_CACHE_MINIMUM,
  rungTokens,
} from './shared.js'

const ID = 'causal/cache-invalidation'

/** What the unchanged repeat must read, of what the first send did not. */
const REPEAT_FRACTION = 0.5
/** What the changed prompt must read, of what the repeat gained, to count as a hit. */
const HIT_FRACTION = 0.5
/**
 * A genuine miss writes the changed prompt afresh, and the prompt is well over
 * the minimum; a hit that writes less than this share of the minimum wrote
 * nothing of it.
 */
const FRESH_WRITE_FRACTION = 0.5

function usageText(label: string, reading: CacheReading): string {
  return `${label}: ${reading.total} prompt tokens, cache_read_input_tokens ${reading.read}, cache_creation_input_tokens ${reading.written}`
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const minimum = claimedAnthropic(context.target)?.cacheMinimumTokens?.value
  if (minimum === undefined) {
    throw new ProbeNotApplicable('No cache minimum is documented for the claimed model.')
  }
  const above = await cacheAbove(context, minimum)
  const first = cacheReading(above.exchange)
  if (first === undefined || !first.cached) {
    return []
  }
  const repeat = cacheReading(await context.send(cacheRequest(context.target, above.text)))
  const gain = repeat === undefined ? 0 : repeat.read - first.read
  if (repeat === undefined || gain < REPEAT_FRACTION * (first.total - first.read)) {
    return []
  }
  const changedText = `B${above.text.slice(1)}`
  const changed = cacheReading(await context.send(cacheRequest(context.target, changedText)))
  if (changed === undefined) {
    return []
  }
  const observed = `${usageText('First send', first)}. ${usageText('Sent again unchanged', repeat)}. ${usageText('Sent with the first character changed', changed)}.`
  const expected =
    'The unchanged prompt reads from the cache; with its first character changed, nothing of it does and it is written afresh.'
  const isHit =
    changed.read - first.read > HIT_FRACTION * gain &&
    changed.written < FRESH_WRITE_FRACTION * minimum
  if (isHit) {
    return [
      causalSignal(ID, {
        signalId: 'changed-prefix-hit',
        calibration: 'documented',
        observed,
        expected,
        llr: { identity: { 'matches-claim': -0.5 }, translation: { translated: 0.8 } },
        plainLanguage:
          "A cached prompt was sent again with its first character changed, and the response reported reading it from the cache. Anthropic's cache only matches identical text from the start, so the cache figures in this response did not come from Anthropic's cache.",
        citations: [ANTHROPIC_CACHE_IDENTICAL_PREFIX],
      }),
    ]
  }
  return [
    causalSignal(ID, {
      signalId: 'changed-prefix-miss',
      calibration: 'documented',
      observed,
      expected,
      llr: {},
      plainLanguage:
        'A cached prompt was read from the cache when sent again unchanged, and was not once its first character changed, as Anthropic documents for its cache.',
      citations: [ANTHROPIC_CACHE_IDENTICAL_PREFIX],
    }),
  ]
}

function applies(target: ProbeTarget): boolean {
  return claimedAnthropic(target)?.cacheMinimumTokens !== undefined
}

export const cacheInvalidation: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Prompt cache needs an identical prefix',
  group: 'D',
  protocols: ['anthropic-messages'],
  vendors: ['anthropic'],
  applies,
  needsKey: true,
  cost: { requests: 3, tokens: 3 * rungTokens(aboveBytes(LARGEST_CACHE_MINIMUM)) },
  citations: [ANTHROPIC_CACHE_IDENTICAL_PREFIX],
  run,
})
