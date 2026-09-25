/**
 * Per-model behaviour facts a fake server needs to answer like the real
 * model it stands in for, read straight off `@verifai/fingerprints` so a
 * backend's behaviour is a function of documented facts, never of a probe id.
 *
 * Two facts `@verifai/fingerprints` does not carry - whether a model keeps a
 * prior turn's thinking as real input, and what it shows by default when
 * `thinking.display` is not set - are Anthropic's documented behaviour too,
 * just not published in a form the fingerprints package models yet.
 * `packages/core/src/probes/causal/shared.ts` carries the same two facts for
 * the probes that read them; only the two models these backends answer as
 * are listed here.
 */

import {
  anthropicModel,
  cheaperAnthropicModels,
  type OpenAIReasoningEffort,
  openaiEncodingFor,
  openaiFingerprintExpectation,
  openaiModel,
  openaiPromptCacheFor,
  type TiktokenEncoding,
} from '@verifai/fingerprints'
import { isTextChatModel } from '../../../src/probes/causal/shared.js'

export interface AnthropicModelFacts {
  readonly id: string
  readonly rejectsSamplingParameters: boolean
  readonly rejectsPrefill: boolean
  readonly rejectsThinkingEnabled: boolean
  readonly rejectsThinkingAdaptive: boolean
  /** `undefined` where Anthropic's own docs are silent for this model - never enforced either way. */
  readonly rejectsThinkingDisabled: boolean | undefined
  /** `undefined` where Anthropic's own docs are silent for this model - never enforced either way. */
  readonly rejectsForcedToolChoice: boolean | undefined
  readonly cacheMinimumTokens: number
  readonly tokenizerGeneration: 'claude-legacy' | 'claude-2026'
  readonly maxOutputTokens: number
  /** Whether a replayed thinking block from this model is honoured as real input. */
  readonly keepsThinking: boolean
  /** What this model shows by default when `thinking.display` is not set. */
  readonly thinkingDisplayDefault: 'omitted' | 'summarized' | undefined
  /** Whether a cheaper Anthropic model shares this model's tokenizer generation. */
  readonly hasCheaperModelWithLegacyTokenizer: boolean
}

const KEEPS_THINKING: ReadonlySet<string> = new Set(['claude-opus-5-5'])

const DISPLAY_DEFAULT: Readonly<Record<string, 'omitted' | 'summarized'>> = Object.freeze({
  'claude-opus-5-5': 'omitted',
})

function required<T>(value: T | undefined, id: string, field: string): T {
  if (value === undefined) {
    throw new Error(`Fixture gap: no documented ${field} for ${id}`)
  }
  return value
}

/** @throws Error if `id` names no documented Anthropic model, or one missing a fact this needs. */
export function anthropicFactsFor(id: string): AnthropicModelFacts {
  const model = anthropicModel(id)
  if (model === undefined) {
    throw new Error(`Not a documented Anthropic model: ${id}`)
  }
  const cheaper = cheaperAnthropicModels(id)
  return Object.freeze({
    id: model.id,
    rejectsSamplingParameters: required(
      model.rejectsSamplingParameters?.value,
      id,
      'rejectsSamplingParameters',
    ),
    rejectsPrefill: required(model.rejectsPrefill?.value, id, 'rejectsPrefill'),
    rejectsThinkingEnabled: required(
      model.rejectsThinkingEnabled?.value,
      id,
      'rejectsThinkingEnabled',
    ),
    rejectsThinkingAdaptive: required(
      model.rejectsThinkingAdaptive?.value,
      id,
      'rejectsThinkingAdaptive',
    ),
    rejectsThinkingDisabled: model.rejectsThinkingDisabled?.value,
    rejectsForcedToolChoice: model.rejectsForcedToolChoice?.value,
    cacheMinimumTokens: required(model.cacheMinimumTokens?.value, id, 'cacheMinimumTokens'),
    tokenizerGeneration: required(model.tokenizer?.value, id, 'tokenizer'),
    maxOutputTokens: required(model.maxOutputTokens?.value, id, 'maxOutputTokens'),
    keepsThinking: KEEPS_THINKING.has(model.id),
    thinkingDisplayDefault: DISPLAY_DEFAULT[model.id],
    hasCheaperModelWithLegacyTokenizer: cheaper.some(
      (candidate) => candidate.tokenizer?.value === 'claude-legacy',
    ),
  })
}

/** What OpenAI's reasoning guides document for one model, read off `OPENAI_MODELS`. */
export interface OpenaiReasoningFacts {
  readonly efforts: readonly OpenAIReasoningEffort[]
  readonly defaultEffort: OpenAIReasoningEffort | undefined
  /** `undefined` where the docs are silent for this model - never enforced either way. */
  readonly rejectsSamplingAtNoneEffort: boolean | undefined
  /** `undefined` where the docs are silent for this model - never enforced either way. */
  readonly rejectsSamplingAtOtherEffort: boolean | undefined
}

export interface OpenaiModelFacts {
  readonly id: string
  readonly encoding: TiktokenEncoding
  readonly cachedTokensMultiple: number
  readonly promptCacheMinimumTokens: number | undefined
  /** Reasons before sampling: takes only its default `temperature`, never `logit_bias`/`logprobs`. */
  readonly isReasoningModel: boolean
  /** Enforces `response_format.json_schema`/`text.format` rather than treating it as a hint. */
  readonly supportsStructuredOutputs: boolean
  /** `undefined` for a model OpenAI's reasoning guides do not list. */
  readonly reasoning: OpenaiReasoningFacts | undefined
  /**
   * `null` where `openaiFingerprintExpectation` finds no documented shape for this id at all
   * (an id outside the Chat Completions enum) - never invented for a model the reference is
   * silent on. Where a shape is documented, both `null` and this pattern are equally genuine
   * (the reference's own examples show both), so this is the fixed value a real deployment of
   * one model would keep showing across requests, not a random draw.
   */
  readonly systemFingerprint: string | null
}

const FNV_OFFSET_BASIS = 0x811c_9dc5
const FNV_PRIME = 0x0100_0193

/**
 * A deterministic, non-cryptographic digest of `id`: `system_fingerprint`'s documented shape is
 * `fp_` plus ten lowercase hex digits, but no page says which digits a given model reports, so
 * this only needs to be stable per model, not real.
 */
function fingerprintDigits(id: string): string {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), FNV_PRIME)
  }
  const first = (hash >>> 0).toString(16).padStart(8, '0')
  const second = Math.imul(hash, FNV_PRIME) >>> 0
  return `${first}${second.toString(16).padStart(8, '0')}`.slice(0, 10)
}

/**
 * Mirrors the unexported `NON_REASONING` regex in
 * `../../../src/probes/causal/shared.ts` (it backs that file's
 * `tokenProbeApplies`, but isn't exported itself) - duplicated here because
 * this fixture needs the same "reasons first" fact independent of any one
 * probe. Keep in sync if that regex changes.
 */
const NON_REASONING = /^(?:gpt-4o|chatgpt-4o|gpt-4\.1|gpt-4-|gpt-4$|gpt-3\.5-turbo)/

/**
 * Mirrors the unexported `OPENAI_STRUCTURED` regex in
 * `../../../src/probes/causal/structured-output.ts` - not exported there, so
 * duplicated here. Keep in sync if that regex changes.
 */
const OPENAI_STRUCTURED =
  /^(?:gpt-4o(?!-2024-05-13)|gpt-4\.1|gpt-5|gpt-6|o1(?!-mini|-preview)|o3|o4-mini)/

function reasoningFactsFor(id: string): OpenaiReasoningFacts | undefined {
  const model = openaiModel(id)
  return model === undefined
    ? undefined
    : Object.freeze({
        efforts: model.reasoningEfforts.value,
        defaultEffort: model.defaultReasoningEffort?.value,
        rejectsSamplingAtNoneEffort: model.rejectsSamplingAtNoneEffort?.value,
        rejectsSamplingAtOtherEffort: model.rejectsSamplingAtOtherEffort?.value,
      })
}

/** Falls back to the current, most permissive facts for an id outside the documented enum. */
export function openaiFactsFor(id: string): OpenaiModelFacts {
  const encoding = openaiEncodingFor(id)?.value ?? 'o200k_base'
  const cache = openaiPromptCacheFor(id)?.value ?? {
    minimumTokens: undefined,
    cachedTokensMultiple: 1,
  }
  const fingerprint = openaiFingerprintExpectation(id)
  return Object.freeze({
    id,
    encoding,
    cachedTokensMultiple: cache.cachedTokensMultiple,
    promptCacheMinimumTokens: cache.minimumTokens,
    isReasoningModel: !NON_REASONING.test(id) && isTextChatModel(id),
    supportsStructuredOutputs: OPENAI_STRUCTURED.test(id) && isTextChatModel(id),
    reasoning: reasoningFactsFor(id),
    systemFingerprint: fingerprint === undefined ? null : `fp_${fingerprintDigits(id)}`,
  })
}
