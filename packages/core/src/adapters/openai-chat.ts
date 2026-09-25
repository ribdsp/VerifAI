/**
 * OpenAI's Chat Completions API, per `CreateChatCompletionResponse` in the
 * OpenAI OpenAPI specification as published on 2026-09-24.
 */

import * as v from 'valibot'
import { type Member, vocabulary } from '../types/vocabulary.js'
import { deviationsFrom, openVariant, orNull, TOKEN_COUNT, WHOLE_NUMBER } from './conformance.js'
import {
  isJsonObject,
  type JsonObject,
  member,
  readArray,
  readCount,
  readNullableString,
  readObject,
  readString,
} from './json.js'
import { OPENAI_AUTH_SCHEMES, openaiHeaders } from './openai-common.js'
import type { Generation, ProtocolAdapter, ReasoningItem, Usage } from './types.js'

export const CHAT_FINISH_REASONS = vocabulary([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'function_call',
])
export type ChatFinishReason = Member<typeof CHAT_FINISH_REASONS>

/** `ServiceTier`. A tier OpenAI adds later reads as a deviation until this list follows it. */
export const CHAT_SERVICE_TIERS = vocabulary([
  'auto',
  'default',
  'flex',
  'scale',
  'priority',
  'fast',
])

/**
 * Where OpenAI-compatible servers other than OpenAI's put a reasoning model's
 * reasoning: DeepSeek and vLLM use `reasoning_content`, OpenRouter
 * `reasoning`. OpenAI's specification has neither.
 */
const REASONING_FIELDS = ['reasoning_content', 'reasoning'] as const

// biome-ignore-start lint/style/useNamingConvention: OpenAI's wire names.
const TOOL_CALL = openVariant('type', {
  function: { id: v.string(), function: v.object({ name: v.string(), arguments: v.string() }) },
  custom: { id: v.string(), custom: v.object({ name: v.string(), input: v.string() }) },
})

const CHOICE = v.object({
  index: WHOLE_NUMBER,
  message: v.object({
    role: v.literal('assistant'),
    content: orNull(v.string()),
    // Required by the specification, and left out of its Functions and
    // Logprobs examples.
    refusal: v.optional(orNull(v.string())),
    tool_calls: v.optional(v.array(TOOL_CALL)),
    annotations: v.optional(v.array(v.unknown())),
  }),
  finish_reason: v.picklist(CHAT_FINISH_REASONS.values),
  // The specification requires `content` and `refusal` inside; its Logprobs
  // example leaves `refusal` out, so neither is asserted.
  logprobs: v.nullable(v.object({})),
})

const CHAT_COMPLETION = v.object({
  id: v.string(),
  object: v.literal('chat.completion'),
  created: WHOLE_NUMBER,
  model: v.string(),
  choices: v.array(CHOICE),
  usage: v.optional(
    v.object({
      prompt_tokens: TOKEN_COUNT,
      completion_tokens: TOKEN_COUNT,
      total_tokens: TOKEN_COUNT,
      prompt_tokens_details: v.optional(v.object({ cached_tokens: v.optional(TOKEN_COUNT) })),
      completion_tokens_details: v.optional(
        v.object({ reasoning_tokens: v.optional(TOKEN_COUNT) }),
      ),
    }),
  ),
  // Typed `string` and deprecated by the specification, while GPT-5 and later
  // send `null`, as the Logprobs example does.
  system_fingerprint: v.optional(orNull(v.string())),
  service_tier: v.optional(orNull(v.picklist(CHAT_SERVICE_TIERS.values))),
})
// biome-ignore-end lint/style/useNamingConvention: OpenAI's wire names.

function readUsage(usage: JsonObject | undefined): Usage | undefined {
  if (usage === undefined) {
    return undefined
  }
  const prompt = readObject(usage, 'prompt_tokens_details')
  const completion = readObject(usage, 'completion_tokens_details')
  return Object.freeze({
    input: readCount(usage, 'prompt_tokens'),
    output: readCount(usage, 'completion_tokens'),
    total: readCount(usage, 'total_tokens'),
    cacheRead: prompt === undefined ? undefined : readCount(prompt, 'cached_tokens'),
    // Chat Completions reports no cache writes.
    cacheCreation: undefined,
    reasoning: completion === undefined ? undefined : readCount(completion, 'reasoning_tokens'),
  })
}

function readReasoning(message: JsonObject | undefined): readonly ReasoningItem[] {
  if (message === undefined) {
    return Object.freeze([])
  }
  return Object.freeze(
    REASONING_FIELDS.flatMap((field): ReasoningItem[] => {
      const text = readString(message, field)
      return text === undefined ? [] : [Object.freeze({ kind: 'reasoning-content', field, text })]
    }),
  )
}

/** The first choice only: a probe asks for one, and `n` is not a protocol concern. */
function firstChoice(body: JsonObject): JsonObject | undefined {
  const first = readArray(body, 'choices')?.[0]
  return isJsonObject(first) ? first : undefined
}

function readGeneration(body: unknown): Generation | undefined {
  if (
    !isJsonObject(body) ||
    (member(body, 'object') !== 'chat.completion' && readArray(body, 'choices') === undefined)
  ) {
    return undefined
  }
  const choice = firstChoice(body)
  const message = choice === undefined ? undefined : readObject(choice, 'message')
  return Object.freeze({
    protocol: 'openai-chat',
    id: readString(body, 'id'),
    model: readString(body, 'model'),
    text: message === undefined ? undefined : readString(message, 'content'),
    stopReason: choice === undefined ? undefined : readNullableString(choice, 'finish_reason'),
    usage: readUsage(readObject(body, 'usage')),
    reasoning: readReasoning(message),
    systemFingerprint: readNullableString(body, 'system_fingerprint'),
    serviceTier: readNullableString(body, 'service_tier'),
    deviations: deviationsFrom(CHAT_COMPLETION, body),
  })
}

export const openaiChat: ProtocolAdapter = Object.freeze({
  protocol: 'openai-chat',
  generatePath: 'chat/completions',
  authSchemes: OPENAI_AUTH_SCHEMES,
  headers: openaiHeaders,
  readGeneration,
})
