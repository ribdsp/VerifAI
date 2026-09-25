/**
 * What the Group D probes share. Each asks the endpoint to do something only
 * the claimed backend does as documented - read back its own thinking
 * signature, start caching at its own minimum, select one token by its ID - so
 * the answer depends on the machinery behind the endpoint, not on how well a
 * layer imitates its wire format.
 *
 * Two probes read the same thinking response and two the same cached prompt,
 * so each is sent once per run through `ctx.shared`.
 *
 * The model facts below that `@verifai/fingerprints` does not carry are local,
 * each cited where it is declared: which models keep earlier thinking, what
 * `thinking.display` defaults to, and which OpenAI models take `logit_bias`
 * and `logprobs` without reasoning first.
 */

import {
  ANTHROPIC_MODELS,
  type AnthropicModel,
  anthropicModel,
  type Fact,
  openaiEncodingFor,
  type TiktokenEncoding,
} from '@verifai/fingerprints'
import { isJsonObject, type JsonObject, objectsIn, readArray } from '../../adapters/json.js'
import type { Generation } from '../../adapters/types.js'
import { ProbeNotApplicable } from '../../runner/errors.js'
import {
  ANTHROPIC_DISPLAY_OMITTED_FABLE_51,
  ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47,
  ANTHROPIC_DISPLAY_OMITTED_OPUS_55,
  ANTHROPIC_DISPLAY_OMITTED_SONNET_5,
} from '../../sources/anthropic-causal.js'
import type { Citation } from '../../sources/citation.js'
import { LOCAL_ENCODINGS, type LocalEncoding } from '../../tokenizer/local.js'
import {
  estimateTokens,
  generationOf,
  generationRequest,
  isSuccess,
  jsonOf,
  signal,
} from '../shared.js'
import {
  CALIBRATIONS,
  type Calibration,
  type Exchange,
  type ProbeContext,
  type ProbeRequest,
  type ProbeTarget,
  type Signal,
} from '../types.js'

export function causalSignal(probeId: string, spec: Omit<Signal, 'probeId' | 'family'>): Signal {
  return signal({ probeId, family: 'causal-capability', ...spec })
}

/** The weakest of the tiers a signal rests on: a conclusion is no stronger than its premises. */
export function weakest(first: Calibration, ...rest: readonly Calibration[]): Calibration {
  const order = CALIBRATIONS.values
  return rest.reduce(
    (weaker, tier) => (order.indexOf(tier) > order.indexOf(weaker) ? tier : weaker),
    first,
  )
}

/** `list` without repeats, in first-seen order, as a signal's citation list. */
export function distinct(list: readonly Citation[]): readonly [Citation, ...Citation[]] {
  const [first, ...rest] = [...new Set(list)]
  if (first === undefined) {
    throw new TypeError('A signal must cite at least one source')
  }
  return [first, ...rest]
}

export function byteLength(text: string | undefined): number {
  return text === undefined ? 0 : new TextEncoder().encode(text).length
}

/** A run's nonce is at most this long, so a static cost can bound any prompt carrying one. */
const MAX_NONCE_LENGTH = 64
export const LONGEST_NONCE = 'x'.repeat(MAX_NONCE_LENGTH)

/** The claimed model's catalogue entry, for an Anthropic claim. */
export function claimedAnthropic(target: ProbeTarget): AnthropicModel | undefined {
  return target.claimedVendor === 'anthropic' ? anthropicModel(target.claimedModel) : undefined
}

/**
 * Prompt tokens as Anthropic bills them: uncached, read and written together.
 * `undefined` without a readable input count.
 */
export function promptTokens(generation: Generation | undefined): number | undefined {
  const usage = generation?.usage
  if (usage?.input === undefined) {
    return undefined
  }
  return usage.input + (usage.cacheRead ?? 0) + (usage.cacheCreation ?? 0)
}

// --- Thinking -------------------------------------------------------------

/**
 * Models that keep earlier thinking blocks in context, per
 * `ANTHROPIC_THINKING_KEPT`: Opus 4.5 and later Opus, Sonnet 4.6 and later
 * Sonnet, and the Fable and Mythos models it names. Every other catalogued
 * model strips them, which leaves a replayed signature nothing to prove.
 */
const KEEPS_THINKING: ReadonlySet<string> = new Set([
  'claude-opus-4-5-20251101',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-opus-5-5',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-fable-5-1',
  'claude-mythos-5-1',
  'claude-fable-5',
  'claude-mythos-5',
  'claude-mythos-preview',
])

export function keepsThinking(model: AnthropicModel): boolean {
  return KEEPS_THINKING.has(model.id)
}

export type ThinkingDisplay = 'omitted' | 'summarized'

export interface DisplayDefault {
  readonly value: ThinkingDisplay
  readonly sources: readonly [Citation, ...Citation[]]
}

function display(value: ThinkingDisplay, ...sources: [Citation, ...Citation[]]): DisplayDefault {
  return Object.freeze({ value, sources: Object.freeze(sources) })
}

/**
 * What `thinking.display` defaults to where Anthropic says so outright. A
 * model missing here has no documented default and is left alone.
 */
const DISPLAY_DEFAULTS: ReadonlyMap<string, DisplayDefault> = new Map([
  [
    'claude-opus-5-5',
    display('omitted', ANTHROPIC_DISPLAY_OMITTED_OPUS_55, ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47),
  ],
  ['claude-opus-5', display('omitted', ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47)],
  ['claude-opus-4-8', display('omitted', ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47)],
  ['claude-opus-4-7', display('omitted', ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47)],
  ['claude-opus-4-6', display('summarized', ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47)],
  ['claude-sonnet-5', display('omitted', ANTHROPIC_DISPLAY_OMITTED_SONNET_5)],
  ['claude-sonnet-4-6', display('summarized', ANTHROPIC_DISPLAY_OMITTED_SONNET_5)],
  ['claude-fable-5-1', display('omitted', ANTHROPIC_DISPLAY_OMITTED_FABLE_51)],
])

export function displayDefault(model: AnthropicModel): DisplayDefault | undefined {
  return DISPLAY_DEFAULTS.get(model.id)
}

/** The smallest budget manual extended thinking accepts. */
const THINKING_BUDGET_TOKENS = 1024

/**
 * A thinking configuration the model accepts: adaptive where it is not
 * rejected, else manual with the smallest budget. `undefined` when the
 * catalogue records neither as accepted. No `display`: its default is what
 * `causal/thinking-display` reads.
 */
export function thinkingConfig(model: AnthropicModel): JsonObject | undefined {
  if (model.rejectsThinkingAdaptive?.value === false) {
    return Object.freeze({ type: 'adaptive' })
  }
  if (model.rejectsThinkingEnabled?.value === false) {
    // biome-ignore lint/style/useNamingConvention: Anthropic's wire name.
    return Object.freeze({ type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS })
  }
  return undefined
}

/** Above the manual budget, which `max_tokens` must exceed. */
export const SEED_MAX_TOKENS = 1280

export function thinkingPrompt(nonce: string): string {
  return `Think it through, then answer with the number only: what is the smallest positive integer that leaves remainder 1 when divided by 2, 3, 4, 5 and 6, and is divisible by 7? (ref ${nonce})`
}

export const SEED_TOKENS = estimateTokens(thinkingPrompt(LONGEST_NONCE)) + SEED_MAX_TOKENS

export interface ThinkingSeed {
  readonly prompt: string
  readonly thinking: JsonObject
  readonly exchange: Exchange
  /** The response's content blocks exactly as they came, for replaying the turn. */
  readonly content: readonly JsonObject[]
  /** `undefined` unless the response was a success. */
  readonly generation: Generation | undefined
}

/**
 * One response with thinking, shared by `causal/thinking-signature` and
 * `causal/thinking-display`.
 *
 * @throws ProbeNotApplicable when the claimed model has no thinking configuration.
 */
export function thinkingSeed(context: ProbeContext): Promise<ThinkingSeed> {
  return context.shared('causal/thinking-seed', async () => {
    const model = claimedAnthropic(context.target)
    const thinking = model === undefined ? undefined : thinkingConfig(model)
    if (thinking === undefined) {
      throw new ProbeNotApplicable('The claimed model has no thinking configuration to ask for.')
    }
    const prompt = thinkingPrompt(context.nonce)
    const exchange = await context.send(
      generationRequest(context.target, {
        prompt,
        maxTokens: SEED_MAX_TOKENS,
        extra: { thinking },
      }),
    )
    const body = jsonOf(exchange)
    const ok = isSuccess(exchange)
    return Object.freeze({
      prompt,
      thinking,
      exchange,
      content: Object.freeze(ok && isJsonObject(body) ? objectsIn(readArray(body, 'content')) : []),
      generation: ok ? generationOf(exchange, 'anthropic-messages') : undefined,
    })
  })
}

// --- Prompt caching -------------------------------------------------------

/** Short, common, harmless words, each one token with its leading space in both OpenAI encodings. */
const CACHE_WORDS: readonly string[] = Object.freeze(
  (
    'river stone light bread cloud green house road field bird snow rain wind hill lake moon ' +
    'star leaf rock sand wave boat town door wall lamp book page song milk salt rice corn farm ' +
    'gate path park shop coat shoe hand king ship fish frog deer bear wolf goat owl bee fox ' +
    'cat dog tea cup bell nest seed tide pond pine rose kite'
  ).split(' '),
)

const CACHE_TAIL = '\n\nReply with the single word: ok.'

export const CACHE_MAX_TOKENS = 16

/**
 * UTF-8 bytes per token of the claimed minimum in the rung above it. The
 * filler runs near 5 bytes a token, so this lands the rung near 1.8 times the
 * minimum; a tokenizer would need over 8 bytes a token to bring it under the
 * 1.1 times `causal/cache-threshold` insists on.
 */
const ABOVE_BYTES_PER_MINIMUM_TOKEN = 9

/** The largest cache minimum in the catalogue, which bounds every rung's static cost. */
export const LARGEST_CACHE_MINIMUM = Math.max(
  ...ANTHROPIC_MODELS.map((model) => model.cacheMinimumTokens?.value ?? 0),
)

export function aboveBytes(minimum: number): number {
  return minimum * ABOVE_BYTES_PER_MINIMUM_TOKEN
}

/** The budget charge of one rung of at most `bytes`. */
export function rungTokens(bytes: number): number {
  return bytes + estimateTokens('') + CACHE_MAX_TOKENS
}

/** 32-bit FNV-1a, to seed the filler from the nonce. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (const unit of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ unit, 0x01000193) >>> 0
  }
  return hash
}

function nextRandom(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0
}

/**
 * ASCII text of at most `bytes`, opening with `lead` and the nonce so no
 * earlier run or other rung shares a prefix with it, and ending with a request
 * for a one-word reply.
 */
export function cacheText(nonce: string, lead: 'A' | 'C', bytes: number): string {
  const head = `${lead} ${nonce}`
  const words: string[] = []
  let length = head.length + CACHE_TAIL.length
  let state = fnv1a(`${lead}${nonce}`)
  for (;;) {
    state = nextRandom(state)
    const word = CACHE_WORDS[(state >>> 16) % CACHE_WORDS.length] ?? 'river'
    if (length + 1 + word.length > bytes) {
      break
    }
    words.push(word)
    length += 1 + word.length
  }
  return `${head} ${words.join(' ')}${CACHE_TAIL}`
}

/** `text` as one user block marked for caching. */
export function cacheRequest(target: ProbeTarget, text: string): ProbeRequest {
  return generationRequest(target, {
    prompt: text,
    maxTokens: CACHE_MAX_TOKENS,
    extra: {
      messages: [
        {
          role: 'user',
          // biome-ignore lint/style/useNamingConvention: Anthropic's wire name.
          content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
        },
      ],
    },
  })
}

export interface CacheReading {
  /** Prompt tokens, uncached, read and written together. */
  readonly total: number
  readonly read: number
  readonly written: number
  readonly cached: boolean
}

/**
 * The cache fields of a successful response. `undefined` when it failed or
 * carries neither field: a response that says nothing about caching says
 * nothing about a threshold.
 */
export function cacheReading(exchange: Exchange): CacheReading | undefined {
  if (!isSuccess(exchange)) {
    return undefined
  }
  const usage = generationOf(exchange, 'anthropic-messages')?.usage
  if (usage?.input === undefined) {
    return undefined
  }
  if (usage.cacheRead === undefined && usage.cacheCreation === undefined) {
    return undefined
  }
  const read = usage.cacheRead ?? 0
  const written = usage.cacheCreation ?? 0
  return Object.freeze({
    total: usage.input + read + written,
    read,
    written,
    cached: read + written > 0,
  })
}

export interface CacheRung {
  readonly text: string
  readonly bytes: number
  readonly exchange: Exchange
}

/**
 * A prompt well above the claimed cache minimum, sent once and shared by
 * `causal/cache-threshold` and `causal/cache-invalidation`.
 */
export function cacheAbove(context: ProbeContext, minimum: number): Promise<CacheRung> {
  return context.shared('causal/cache-above', async () => {
    const bytes = aboveBytes(minimum)
    const text = cacheText(context.nonce, 'A', bytes)
    const exchange = await context.send(cacheRequest(context.target, text))
    return Object.freeze({ text, bytes, exchange })
  })
}

// --- OpenAI tokens --------------------------------------------------------

/**
 * Non-reasoning chat models. OpenAI's reasoning models spend a small output
 * limit before any visible token and refuse `logprobs` while they reason, so
 * the two token-ID probes speak only to these.
 */
const NON_REASONING = /^(?:gpt-4o|chatgpt-4o|gpt-4\.1|gpt-4-|gpt-4$|gpt-3\.5-turbo)/
const NOT_TEXT_CHAT = /(?:audio|realtime|transcribe|tts|search)/

/** The claimed model's encoding, when it is one this build carries. */
export function localEncodingFor(model: string): Fact<TiktokenEncoding> | undefined {
  const fact = openaiEncodingFor(model)
  return fact !== undefined && LOCAL_ENCODINGS.has(fact.value) ? fact : undefined
}

/** Not an audio, realtime, transcription, speech or search variant. */
export function isTextChatModel(model: string): boolean {
  return !NOT_TEXT_CHAT.test(model)
}

export function tokenProbeApplies(target: ProbeTarget): boolean {
  const model = target.claimedModel
  return (
    NON_REASONING.test(model) && isTextChatModel(model) && localEncodingFor(model) !== undefined
  )
}

export interface Encodings {
  readonly claimed: LocalEncoding
  readonly other: LocalEncoding
  readonly fact: Fact<TiktokenEncoding>
}

/** The claimed model's encoding and the other one this build carries. */
export function encodingsFor(model: string): Encodings {
  const fact = localEncodingFor(model)
  if (fact === undefined || !LOCAL_ENCODINGS.has(fact.value)) {
    throw new ProbeNotApplicable('No local encoding is known for the claimed model.')
  }
  const claimed = fact.value
  const other = LOCAL_ENCODINGS.values.find((encoding) => encoding !== claimed) ?? claimed
  return Object.freeze({ claimed, other, fact })
}
