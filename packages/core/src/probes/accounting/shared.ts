/**
 * The one generation Group B reads, and the vocabulary its probes share.
 *
 * Every accounting probe reads the same response, so the buyer pays for it
 * once. The prompt asks for far more than the output limit allows - the
 * smallest limit the endpoint accepts, found by `sendAtOutputFloor` - so a
 * genuine backend stops at the limit and says it did. It is also long enough,
 * a few hundred tokens, that a tokenizer step of ten percent is dozens of
 * tokens rather than rounding.
 */

import type { Generation, Usage } from '../../adapters/types.js'
import { ProbeLost } from '../../runner/errors.js'
import type { Citation } from '../../sources/citation.js'
import type { Protocol } from '../../types/target.js'
import { discoveryCost, MAX_OUTPUT_FLOOR, sendAtOutputFloor } from '../output-floor.js'
import { estimateTokens, generationOf, isSuccess, signal } from '../shared.js'
import type { Exchange, ProbeContext, ProbeRequest, Signal } from '../types.js'

export function baselinePrompt(nonce: string): string {
  return [
    `Reference ${nonce}.`,
    'Write a long, detailed essay of at least twelve paragraphs about ocean tides, and do not stop early.',
    'Cover how the gravity of the Moon and the Sun raises two bulges of water on opposite sides of the Earth;',
    'why most coasts see two high tides and two low tides a little more than a day apart;',
    'how spring tides follow the new and full Moon while neap tides follow the quarter Moons;',
    'why the shape of a bay or an estuary can amplify the range until the water rises many metres, as it does in the Bay of Fundy;',
    'how tidal currents scour channels, carry sediment and feed salt marshes;',
    'how sailors, fishers and harbour pilots have read tide tables for centuries;',
    'how tide gauges and satellites measure sea level today;',
    "and how the slow transfer of energy from the Earth's rotation to the Moon's orbit lengthens the day.",
    'Give the word for tide in Indonesian (pasang surut), Japanese (潮汐) and Russian (прилив).',
    'Give each paragraph a plain heading, and write in full sentences.',
  ].join(' ')
}

/** The longest nonce a run uses, for an upper bound that holds whatever the nonce. */
const LONGEST_NONCE = 'x'.repeat(64)

const BASELINE_PROMPT_TOKENS = estimateTokens(baselinePrompt(LONGEST_NONCE))
const BASELINE_DISCOVERY = discoveryCost(BASELINE_PROMPT_TOKENS)

/** What the baseline may bill: once at the highest output limit it may set, after finding it. */
export const BASELINE_COST = Object.freeze({
  requests: 1 + BASELINE_DISCOVERY.requests,
  tokens: BASELINE_PROMPT_TOKENS + MAX_OUTPUT_FLOOR + BASELINE_DISCOVERY.tokens,
})

export interface Baseline {
  readonly prompt: string
  readonly outputLimit: number
  /** The smaller limit the endpoint refused before accepting `outputLimit`, if it refused one. */
  readonly refusedLimit?: number
  readonly request: ProbeRequest
  readonly exchange: Exchange
  readonly generation: Generation
}

/**
 * The baseline generation, sent once per run and protocol.
 *
 * @throws ProbeLost when the endpoint does not answer it with a generation,
 * which leaves every accounting probe with nothing to read.
 */
export function baseline(context: ProbeContext): Promise<Baseline> {
  const { protocol } = context.target
  return context.shared(`accounting/${protocol}-baseline`, async () => {
    const prompt = baselinePrompt(context.nonce)
    const sent = await sendAtOutputFloor(context, prompt)
    const generation = isSuccess(sent.exchange) ? generationOf(sent.exchange, protocol) : undefined
    if (generation === undefined) {
      throw new ProbeLost('The endpoint did not answer the accounting baseline with a generation.')
    }
    return Object.freeze({ prompt, ...sent, generation })
  })
}

/** Each protocol's name for a stop at the output limit. */
export const LENGTH_STOP_REASONS: Readonly<Record<Protocol, string>> = Object.freeze({
  'anthropic-messages': 'max_tokens',
  'openai-chat': 'length',
  'openai-responses': 'max_output_tokens',
})

/**
 * Every input token a generation reports. Anthropic counts cache reads and
 * writes beside `input_tokens`; OpenAI counts cached tokens inside it.
 */
export function reportedInput(protocol: Protocol, usage: Usage | undefined): number | undefined {
  if (usage?.input === undefined) {
    return undefined
  }
  if (protocol !== 'anthropic-messages') {
    return usage.input
  }
  return usage.input + (usage.cacheRead ?? 0) + (usage.cacheCreation ?? 0)
}

/** A Group B signal: `probeId` and `family` filled in. */
export function accountingSignal(
  probeId: string,
  spec: Omit<Signal, 'probeId' | 'family'>,
): Signal {
  return signal({ probeId, family: 'accounting', ...spec })
}

/** `list` without repeats, in first-seen order, as a signal's citation list. */
export function distinctCitations(list: readonly Citation[]): readonly [Citation, ...Citation[]] {
  const [first, ...rest] = [...new Set(list)]
  if (first === undefined) {
    throw new TypeError('A signal must cite at least one source')
  }
  return [first, ...rest]
}
