/**
 * What OpenAI publishes that a probe can check a response against: which
 * tiktoken encoding a model ID maps to, which dated snapshots stand behind
 * an alias, the shape of `system_fingerprint`, and prompt-cache rounding.
 *
 * OpenAI documents far fewer per-model behaviours than Anthropic, so most of
 * these are weaker than `documented`. Each lookup returns `undefined` for an
 * ID it cannot place, rather than guessing from the name.
 */

import { cheaperThan, indexByName } from './lookup.js'
import { OPENAI_MODELS, type OpenAIModel } from './openai-models.js'
import {
  chatModelSource,
  FINGERPRINT,
  OPENAI_CHAT_MODEL_IDS,
  PROMPT_CACHE,
  TIKTOKEN_LOOKUP,
  tiktokenSource,
} from './openai-sources.js'
import { documented, type Fact, type FactSource, fact } from './source.js'

export {
  OPENAI_MODELS,
  type OpenAIModel,
  type OpenAIPricing,
  type OpenAIReasoningEffort,
} from './openai-models.js'
export { OPENAI_CHAT_MODEL_IDS } from './openai-sources.js'

export type TiktokenEncoding = 'o200k_base' | 'o200k_harmony' | 'cl100k_base'

export interface TiktokenRule {
  /** A full model name, or a prefix, as tiktoken writes it. */
  readonly name: string
  readonly encoding: TiktokenEncoding
}

function rules(entries: readonly (readonly [string, TiktokenEncoding])[]): readonly TiktokenRule[] {
  return Object.freeze(entries.map(([name, encoding]) => Object.freeze({ name, encoding })))
}

/** tiktoken's `MODEL_TO_ENCODING`, chat models only. */
export const OPENAI_EXACT_ENCODINGS: readonly TiktokenRule[] = rules([
  ['o1', 'o200k_base'],
  ['o3', 'o200k_base'],
  ['o4-mini', 'o200k_base'],
  ['gpt-5', 'o200k_base'],
  ['gpt-4.1', 'o200k_base'],
  ['gpt-4o', 'o200k_base'],
  ['gpt-4', 'cl100k_base'],
  ['gpt-3.5-turbo', 'cl100k_base'],
  ['gpt-3.5', 'cl100k_base'],
  ['gpt-35-turbo', 'cl100k_base'],
])

/** tiktoken's `MODEL_PREFIX_TO_ENCODING`, chat models only, in its order: the first match wins. */
export const OPENAI_PREFIX_ENCODINGS: readonly TiktokenRule[] = rules([
  ['o1-', 'o200k_base'],
  ['o3-', 'o200k_base'],
  ['o4-mini-', 'o200k_base'],
  ['gpt-5', 'o200k_base'],
  ['gpt-4.5-', 'o200k_base'],
  ['gpt-4.1-', 'o200k_base'],
  ['chatgpt-4o-', 'o200k_base'],
  ['gpt-4o-', 'o200k_base'],
  ['gpt-4-', 'cl100k_base'],
  ['gpt-3.5-turbo-', 'cl100k_base'],
  ['gpt-35-turbo-', 'cl100k_base'],
  ['gpt-oss-', 'o200k_harmony'],
  ['ft:gpt-4o', 'o200k_base'],
  ['ft:gpt-4', 'cl100k_base'],
  ['ft:gpt-3.5-turbo', 'cl100k_base'],
])

const ENCODING_NOTE =
  'tiktoken matches by name, so a prefix also maps IDs OpenAI never served; `gpt-6` models have no entry.'

function encodingFact(rule: TiktokenRule, lookup: FactSource): Fact<TiktokenEncoding> {
  return fact(
    'derived',
    rule.encoding,
    [tiktokenSource(rule.name, rule.encoding), lookup],
    ENCODING_NOTE,
  )
}

/** The encoding tiktoken's `encoding_for_model` would pick for `id`, or `undefined` where it raises. */
export function openaiEncodingFor(id: string): Fact<TiktokenEncoding> | undefined {
  const exact = OPENAI_EXACT_ENCODINGS.find((rule) => rule.name === id)
  if (exact !== undefined) {
    return encodingFact(exact, TIKTOKEN_LOOKUP.exactFirst)
  }
  const prefix = OPENAI_PREFIX_ENCODINGS.find((rule) => id.startsWith(rule.name))
  return prefix === undefined ? undefined : encodingFact(prefix, TIKTOKEN_LOOKUP.firstPrefix)
}

const CHAT_IDS: ReadonlySet<string> = new Set(OPENAI_CHAT_MODEL_IDS)

/** `gpt-4o-2024-08-06` and `gpt-4-0613` both split into an alias and a date. */
const DATED = /^(.+)-(\d{4}-\d{2}-\d{2}|\d{4})$/

/**
 * `pinned`: a dated ID, expected back unchanged in the response's `model`.
 * `alias`: an undated ID and the dated IDs the reference lists under it.
 */
export type OpenAISnapshot =
  | { readonly kind: 'pinned'; readonly alias: string; readonly echo: string }
  | { readonly kind: 'alias'; readonly alias: string; readonly candidates: readonly string[] }

const PINNED_NOTE = 'Inferred from the dated ID; no page says what `model` echoes.'
const ALIAS_NOTE =
  'The reference lists these dated IDs under the alias; no page says which one `model` reports, so an echo outside them is a lead, not proof.'

/**
 * `undefined` for an ID outside the Chat Completions enum, and for an alias
 * with no dated ID listed (`-latest` pointers, `gpt-5.6` and `gpt-6` models).
 */
export function openaiSnapshotFor(id: string): Fact<OpenAISnapshot> | undefined {
  if (!CHAT_IDS.has(id)) {
    return undefined
  }
  const alias = DATED.exec(id)?.[1]
  if (alias !== undefined) {
    return fact(
      'heuristic',
      { kind: 'pinned', alias, echo: id },
      [chatModelSource(id)],
      PINNED_NOTE,
    )
  }
  const candidates = OPENAI_CHAT_MODEL_IDS.filter((other) => DATED.exec(other)?.[1] === id)
  if (candidates.length === 0) {
    return undefined
  }
  return fact(
    'heuristic',
    { kind: 'alias', alias: id, candidates: Object.freeze(candidates) },
    [chatModelSource(id), ...candidates.map(chatModelSource)],
    ALIAS_NOTE,
  )
}

export interface OpenAIFingerprintExpectation {
  /** The field is optional; the reference's own examples include `null`. */
  readonly mayBeNull: boolean
  /** A regular expression source for a present value. */
  readonly pattern: string
}

const FINGERPRINT_EXPECTATION: Fact<OpenAIFingerprintExpectation> = fact(
  'heuristic',
  { mayBeNull: true, pattern: '^fp_[0-9a-f]{10}$' },
  [
    FINGERPRINT.optional,
    FINGERPRINT.meaning,
    FINGERPRINT.streamExample,
    FINGERPRINT.example,
    FINGERPRINT.nullExample,
  ],
  'The format is read off two reference examples; OpenAI does not specify it.',
)

/** `undefined` for an ID outside the Chat Completions enum. */
export function openaiFingerprintExpectation(
  id: string,
): Fact<OpenAIFingerprintExpectation> | undefined {
  return CHAT_IDS.has(id) ? FINGERPRINT_EXPECTATION : undefined
}

export interface OpenAIPromptCache {
  /** `undefined` where the guide says the minimum "varies by request settings". */
  readonly minimumTokens: number | undefined
  /** Reported `cached_tokens` is a multiple of this; 1 where reporting is exact. */
  readonly cachedTokensMultiple: number
}

const GENERATION_NOTE = 'The generation is read from the model ID.'

const PROMPT_CACHE_CURRENT: Fact<OpenAIPromptCache> = documented(
  { minimumTokens: 1024, cachedTokensMultiple: 1 },
  [PROMPT_CACHE.minimum, PROMPT_CACHE.minimumRow, PROMPT_CACHE.reportingRow, PROMPT_CACHE.columns],
  `Counts visible input tokens only. ${GENERATION_NOTE}`,
)

const PROMPT_CACHE_EARLIER: Fact<OpenAIPromptCache> = documented(
  { minimumTokens: undefined, cachedTokensMultiple: 128 },
  [
    PROMPT_CACHE.earlierRounding,
    PROMPT_CACHE.reportingRow,
    PROMPT_CACHE.minimumRow,
    PROMPT_CACHE.columns,
  ],
  GENERATION_NOTE,
)

const GPT_VERSION = /^gpt-(\d+)(?:\.(\d+))?(?:-|$)/

function isGpt56OrLater(id: string): boolean {
  const match = GPT_VERSION.exec(id)
  if (match === null) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2] ?? '0')
  return major > 5 || (major === 5 && minor >= 6)
}

/** `undefined` for an ID outside the Chat Completions enum. */
export function openaiPromptCacheFor(id: string): Fact<OpenAIPromptCache> | undefined {
  if (!CHAT_IDS.has(id)) {
    return undefined
  }
  return isGpt56OrLater(id) ? PROMPT_CACHE_CURRENT : PROMPT_CACHE_EARLIER
}

const BY_NAME: ReadonlyMap<string, OpenAIModel> = indexByName(
  'OpenAI',
  OPENAI_MODELS,
  (model) => model.snapshots.value,
)

/** The model a `model` value names, by ID or default snapshot; `undefined` if the table has none. */
export function openaiModel(id: string): OpenAIModel | undefined {
  return BY_NAME.get(id)
}

/**
 * Priced models that are at least as cheap on input and output and strictly
 * cheaper on one: the substitutes a reseller billing for `id` would gain by
 * serving instead. Cheapest first. Empty if `id` is unknown or unpriced.
 */
export function cheaperOpenaiModels(id: string): readonly OpenAIModel[] {
  return cheaperThan(OPENAI_MODELS, openaiModel(id))
}
