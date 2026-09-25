/**
 * Pure decision logic for one Anthropic Messages `create` request: whether a
 * genuine Claude endpoint would refuse this body, and if not, what it would
 * answer. Everything here is a function of the request and the answering
 * model's own documented facts (`AnthropicModelFacts`) plus the small
 * per-backend state (`AnthropicState`) a real deployment also carries -
 * nothing is keyed off a probe id or nonce.
 *
 * Rejection wording comes straight from `@verifai/fingerprints`'
 * `ANTHROPIC_REJECTIONS`, so a genuine fake reproduces both the status and the
 * exact words `conformance/anthropic/*-matrix` checks for.
 */

import { ANTHROPIC_REJECTIONS, anthropicModel } from '@verifai/fingerprints'
import { type AnthropicState, issueSignature } from './anthropic-state.js'
import type { AnthropicModelFacts } from './model-facts.js'
import { instanceFor } from './schema-instance.js'
import {
  anthropicErrorBody,
  anthropicMessageId,
  anthropicPromptText,
  isJsonObject,
  type JsonObject,
  pseudoTokenCount,
} from './shared.js'

export interface AnthropicServerConfig {
  /** `false` reproduces `signature-forger`: it never checks a replayed signature. */
  readonly verifiesThinkingSignatures: boolean
}

/**
 * The documented step between Claude's two tokenizer generations: the newer
 * one (`claude-2026`) counts the same text as roughly 1x to 1.35x as many
 * tokens as the legacy one - see `sources/anthropic.ts` and
 * `sources/measured-accounting.ts`. Applying it wherever a count is billed
 * against a specific model's tokenizer is what lets a differential-count draw
 * that lands on a model from the other generation disagree with one that does
 * not, and lets `count_tokens` genuinely agree or disagree with `usage`
 * instead of always matching the legacy baseline; nothing here is keyed off a
 * probe id or nonce.
 */
const NEWER_TOKENIZER_STEP = 1.3

/** `text`'s token count under the tokenizer of `generation`, `undefined` reading as legacy's. */
function scaledTokenCount(
  text: string,
  generation: AnthropicModelFacts['tokenizerGeneration'] | undefined,
): number {
  const base = pseudoTokenCount(text)
  return generation === 'claude-2026' ? Math.ceil(base * NEWER_TOKENIZER_STEP) : base
}

/** Input tokens for `text`, counted the way the model behind `facts` would count them. */
function promptTokenCount(text: string, facts: AnthropicModelFacts): number {
  return scaledTokenCount(text, facts.tokenizerGeneration)
}

export interface AnthropicAnswer {
  readonly status: number
  readonly body: JsonObject
}

/** Every top-level field the Messages `create` body documents. Anything else is foreign. */
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  'model',
  'messages',
  'system',
  'max_tokens',
  'metadata',
  'stop_sequences',
  'stream',
  'temperature',
  'top_p',
  'top_k',
  'tools',
  'tool_choice',
  'thinking',
  'output_config',
  'service_tier',
])

/** Above `thinking-signature.ts`'s 256-token floor, comfortably clearing its 0.5x-of-that margin. */
const THINKING_TOKENS_REPORTED = 400
/** Large enough that a kept replay clears `KEPT_FRACTION * thinking` against any small follow-up. */
const REPLAY_BONUS_TOKENS = 500
const ANSWER_TEXT = 'ok'

function rejected(errorType: string, message: string): AnthropicAnswer {
  return { status: 400, body: anthropicErrorBody(errorType, message) }
}

function messagesOf(body: JsonObject): readonly JsonObject[] {
  return Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : []
}

function contentBlocksOf(message: JsonObject): readonly JsonObject[] {
  return Array.isArray(message.content) ? message.content.filter(isJsonObject) : []
}

function unknownFieldRejection(body: JsonObject): AnthropicAnswer | undefined {
  const foreign = Object.keys(body).find((key) => !ALLOWED_FIELDS.has(key))
  return foreign === undefined
    ? undefined
    : rejected('invalid_request_error', `${foreign}: Extra inputs are not permitted`)
}

function missingMaxTokensRejection(body: JsonObject): AnthropicAnswer | undefined {
  return typeof body.max_tokens === 'number'
    ? undefined
    : rejected('invalid_request_error', 'max_tokens: Field required')
}

const MINIMUM_ACCEPTED_TOP_P = 0.99
const ACCEPTED_TEMPERATURE = 1
/** The documented ceiling every Claude model holds `temperature` to - see `ANTHROPIC_TEMPERATURE_RANGE`. */
const MAXIMUM_TEMPERATURE = 1

/**
 * No `AnthropicRejection` documents exact sampling-rejection wording (unlike
 * thinking/prefill/forced-tool-choice), so `sampling-matrix.ts` and
 * `permissive-validator.ts` never check it either - only the status and
 * dialect need to be genuine here.
 */
function samplingRejection(
  body: JsonObject,
  facts: AnthropicModelFacts,
): AnthropicAnswer | undefined {
  if (!facts.rejectsSamplingParameters) {
    return typeof body.temperature === 'number' && body.temperature > MAXIMUM_TEMPERATURE
      ? rejected('invalid_request_error', 'temperature: Input should be less than or equal to 1')
      : undefined
  }
  if (typeof body.temperature === 'number' && body.temperature !== ACCEPTED_TEMPERATURE) {
    return rejected('invalid_request_error', 'temperature: Extra inputs are not permitted')
  }
  if (typeof body.top_p === 'number' && body.top_p < MINIMUM_ACCEPTED_TOP_P) {
    return rejected('invalid_request_error', 'top_p: Extra inputs are not permitted')
  }
  if ('top_k' in body) {
    return rejected('invalid_request_error', 'top_k: Extra inputs are not permitted')
  }
  return undefined
}

function prefillRejection(
  body: JsonObject,
  facts: AnthropicModelFacts,
): AnthropicAnswer | undefined {
  const messages = messagesOf(body)
  const last = messages.at(-1)
  if (!facts.rejectsPrefill || last?.role !== 'assistant') {
    return undefined
  }
  return rejected('invalid_request_error', ANTHROPIC_REJECTIONS.prefill.value.message)
}

function thinkingModeRejection(
  body: JsonObject,
  facts: AnthropicModelFacts,
): AnthropicAnswer | undefined {
  const thinking = isJsonObject(body.thinking) ? body.thinking : undefined
  if (thinking === undefined) {
    return undefined
  }
  if (thinking.type === 'enabled' && facts.rejectsThinkingEnabled) {
    return rejected('invalid_request_error', ANTHROPIC_REJECTIONS.thinkingEnabled.value.message)
  }
  if (thinking.type === 'adaptive' && facts.rejectsThinkingAdaptive) {
    return rejected('invalid_request_error', ANTHROPIC_REJECTIONS.thinkingAdaptive.value.message)
  }
  if (thinking.type === 'disabled' && facts.rejectsThinkingDisabled === true) {
    return rejected('invalid_request_error', ANTHROPIC_REJECTIONS.thinkingDisabled.value.message)
  }
  return undefined
}

function forcedToolChoiceRejection(
  body: JsonObject,
  facts: AnthropicModelFacts,
): AnthropicAnswer | undefined {
  const toolChoice = isJsonObject(body.tool_choice) ? body.tool_choice : undefined
  const forced = toolChoice?.type === 'any' || toolChoice?.type === 'tool'
  if (!forced || facts.rejectsForcedToolChoice !== true) {
    return undefined
  }
  return rejected('invalid_request_error', ANTHROPIC_REJECTIONS.forcedToolChoice.value.message)
}

/** Whether this model thinks for this request: always-on models think unconditionally. */
function shouldThink(body: JsonObject, facts: AnthropicModelFacts): boolean {
  if (facts.rejectsThinkingDisabled === true) {
    return true
  }
  const thinking = isJsonObject(body.thinking) ? body.thinking : undefined
  if (thinking?.type === 'enabled') {
    return !facts.rejectsThinkingEnabled
  }
  if (thinking?.type === 'adaptive') {
    return !facts.rejectsThinkingAdaptive
  }
  return false
}

function isSignedThinkingBlock(block: JsonObject): boolean {
  return block.type === 'thinking' && typeof block.signature === 'string' && block.signature !== ''
}

/** Signatures a prior assistant turn replays, from every message but the one being answered. */
function replayedSignatures(body: JsonObject): readonly string[] {
  const history = messagesOf(body).slice(0, -1)
  return history
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => contentBlocksOf(message).filter(isSignedThinkingBlock))
    .map((block) => block.signature as string)
}

/**
 * The extra input tokens a replayed thinking block earns, or a rejection if a
 * verifying model catches a signature it never issued.
 */
function replayOutcome(
  body: JsonObject,
  facts: AnthropicModelFacts,
  config: AnthropicServerConfig,
  state: AnthropicState,
): { readonly bonus: number } | AnthropicAnswer {
  const signatures = replayedSignatures(body)
  if (signatures.length === 0 || !facts.keepsThinking) {
    return { bonus: 0 }
  }
  if (config.verifiesThinkingSignatures) {
    const tampered = signatures.some((signature) => !state.signatures.has(signature))
    if (tampered) {
      return rejected('invalid_request_error', 'The thinking signature could not be verified.')
    }
  }
  return { bonus: REPLAY_BONUS_TOKENS }
}

interface CacheOutcome {
  readonly readTokens: number
  readonly creationTokens: number
}

/** The one text block a cache probe marks with `cache_control`, if this request carries one. */
function cacheControlText(body: JsonObject): string | undefined {
  for (const message of messagesOf(body)) {
    for (const block of contentBlocksOf(message)) {
      if (
        block.type === 'text' &&
        isJsonObject(block.cache_control) &&
        typeof block.text === 'string'
      ) {
        return block.text
      }
    }
  }
  return undefined
}

function cacheOutcome(
  body: JsonObject,
  facts: AnthropicModelFacts,
  state: AnthropicState,
): CacheOutcome | undefined {
  const text = cacheControlText(body)
  if (text === undefined) {
    return undefined
  }
  const tokens = promptTokenCount(text, facts)
  if (tokens < facts.cacheMinimumTokens) {
    return { readTokens: 0, creationTokens: 0 }
  }
  const cached = state.cache.get(text)
  if (cached !== undefined) {
    return { readTokens: cached, creationTokens: 0 }
  }
  state.cache.set(text, tokens)
  return { readTokens: 0, creationTokens: tokens }
}

function thinkingBlock(
  body: JsonObject,
  facts: AnthropicModelFacts,
  state: AnthropicState,
): JsonObject {
  const requested = isJsonObject(body.thinking) ? body.thinking.display : undefined
  const display = typeof requested === 'string' ? requested : facts.thinkingDisplayDefault
  const text = display === 'omitted' ? '' : 'Working through the answer.'
  return { type: 'thinking', thinking: text, signature: issueSignature(state) }
}

function answerText(body: JsonObject): string {
  const outputConfig = isJsonObject(body.output_config) ? body.output_config : undefined
  const format = isJsonObject(outputConfig?.format) ? outputConfig.format : undefined
  const schema = format?.type === 'json_schema' ? format.schema : undefined
  return schema === undefined ? ANSWER_TEXT : JSON.stringify(instanceFor(schema))
}

/** @throws never - an unresolvable body still gets a best-effort answer, not a throw. */
export function answerAnthropicMessages(
  body: JsonObject,
  facts: AnthropicModelFacts,
  config: AnthropicServerConfig,
  state: AnthropicState,
): AnthropicAnswer {
  const rejection =
    unknownFieldRejection(body) ??
    missingMaxTokensRejection(body) ??
    samplingRejection(body, facts) ??
    prefillRejection(body, facts) ??
    thinkingModeRejection(body, facts) ??
    forcedToolChoiceRejection(body, facts)
  if (rejection !== undefined) {
    return rejection
  }
  const replay = replayOutcome(body, facts, config, state)
  if ('status' in replay) {
    return replay
  }
  const cache = cacheOutcome(body, facts, state)
  const text = answerText(body)
  const thinks = shouldThink(body, facts)
  const content: JsonObject[] = thinks ? [thinkingBlock(body, facts, state)] : []
  content.push({ type: 'text', text })
  const promptTokens = promptTokenCount(anthropicPromptText(body), facts)
  const cachedPortion = (cache?.readTokens ?? 0) + (cache?.creationTokens ?? 0)
  const inputTokens = Math.max(0, promptTokens - cachedPortion) + replay.bonus
  // `max_tokens` is a hard ceiling on thinking plus text combined, not just the visible
  // answer - an always-thinking model given too little of it stops mid-thought, the same
  // as it would with any other output, and reports the ceiling's stop reason for doing so.
  const desiredThinkingTokens = thinks ? THINKING_TOKENS_REPORTED : 0
  const desiredOutputTokens = pseudoTokenCount(text) + desiredThinkingTokens
  const ceiling = typeof body.max_tokens === 'number' ? body.max_tokens : desiredOutputTokens
  const outputTokens = Math.min(desiredOutputTokens, ceiling)
  const stopReason = outputTokens === ceiling ? 'max_tokens' : 'end_turn'
  const thinkingTokens = Math.min(desiredThinkingTokens, outputTokens)
  // biome-ignore-start lint/style/useNamingConvention: wire format
  return {
    status: 200,
    body: {
      id: anthropicMessageId(),
      type: 'message',
      role: 'assistant',
      model: facts.id,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        ...(cache === undefined
          ? {}
          : {
              cache_read_input_tokens: cache.readTokens,
              cache_creation_input_tokens: cache.creationTokens,
            }),
        ...(thinks ? { output_tokens_details: { thinking_tokens: thinkingTokens } } : {}),
      },
    },
  }
  // biome-ignore-end lint/style/useNamingConvention: wire format
}

/**
 * For `/v1/messages/count_tokens`: Anthropic's docs say this counts under the
 * tokenizer of the model named in the request body, not whatever model a
 * gateway's generate calls actually reach - so this reads `body.model`,
 * independent of the `facts` `answerAnthropicMessages` answers with. A
 * gateway that silently answers as a cheaper model still has this endpoint
 * agree with the claim, which is what lets a genuine mismatch between the two
 * counts point at the substitution rather than at this fixture's own choices.
 */
export function countAnthropicTokens(body: JsonObject): JsonObject {
  const generation =
    typeof body.model === 'string' ? anthropicModel(body.model)?.tokenizer?.value : undefined
  // biome-ignore lint/style/useNamingConvention: wire format
  return { input_tokens: scaledTokenCount(anthropicPromptText(body), generation) }
}
