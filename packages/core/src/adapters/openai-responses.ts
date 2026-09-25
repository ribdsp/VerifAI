/**
 * OpenAI's Responses API, per `Response` in the OpenAI OpenAPI specification
 * as published on 2026-09-24.
 */

import * as v from 'valibot'
import { type Member, vocabulary } from '../types/vocabulary.js'
import { deviationsFrom, openVariant, orNull, TOKEN_COUNT } from './conformance.js'
import {
  isJsonObject,
  type JsonObject,
  joinTexts,
  member,
  objectsIn,
  readArray,
  readCount,
  readNullableString,
  readObject,
  readString,
} from './json.js'
import { OPENAI_AUTH_SCHEMES, openaiHeaders } from './openai-common.js'
import type { Generation, ProtocolAdapter, ReasoningItem, Usage } from './types.js'

export const RESPONSE_STATUSES = vocabulary([
  'completed',
  'failed',
  'in_progress',
  'cancelled',
  'queued',
  'incomplete',
])
export type ResponseStatus = Member<typeof RESPONSE_STATUSES>

export const INCOMPLETE_REASONS = vocabulary([
  'max_output_tokens',
  'max_messages',
  'content_filter',
  'steered',
])

/** `ServiceTierResponses`, which has one tier more than Chat Completions' `ServiceTier`. */
export const RESPONSES_SERVICE_TIERS = vocabulary([
  'auto',
  'default',
  'flex',
  'scale',
  'priority',
  'fast',
  'ultrafast',
])

const ITEM_STATUSES = ['in_progress', 'completed', 'incomplete'] as const

// biome-ignore-start lint/style/useNamingConvention: OpenAI's wire names.
const MESSAGE_CONTENT = openVariant('type', {
  // `logprobs` is required by the specification and left out of most of its
  // examples, so it is not asserted.
  output_text: { text: v.string(), annotations: v.array(v.unknown()) },
  refusal: { refusal: v.string() },
})

const OUTPUT_ITEM = openVariant('type', {
  message: {
    id: v.string(),
    role: v.literal('assistant'),
    status: v.picklist(ITEM_STATUSES),
    content: v.array(MESSAGE_CONTENT),
  },
  reasoning: {
    id: v.string(),
    summary: v.array(v.object({ type: v.literal('summary_text'), text: v.string() })),
    encrypted_content: v.optional(orNull(v.string())),
  },
  function_call: { call_id: v.string(), name: v.string(), arguments: v.string() },
})

const RESPONSE = v.object({
  id: v.string(),
  object: v.literal('response'),
  created_at: v.number(),
  status: v.optional(v.picklist(RESPONSE_STATUSES.values)),
  error: v.nullable(v.object({ code: v.string(), message: v.string() })),
  incomplete_details: v.nullable(
    v.object({ reason: v.optional(v.picklist(INCOMPLETE_REASONS.values)) }),
  ),
  model: v.string(),
  output: v.array(OUTPUT_ITEM),
  // Echoes of the request that the specification requires and every example
  // sends. Only their presence and outline are asserted.
  access_programs: v.nullable(v.object({})),
  instructions: v.unknown(),
  tools: v.array(v.unknown()),
  tool_choice: v.unknown(),
  parallel_tool_calls: v.boolean(),
  metadata: orNull(v.record(v.string(), v.string())),
  temperature: orNull(v.number()),
  top_p: orNull(v.number()),
  usage: v.optional(
    v.object({
      input_tokens: TOKEN_COUNT,
      output_tokens: TOKEN_COUNT,
      total_tokens: TOKEN_COUNT,
      // Both details objects are required by the specification; its Functions
      // example leaves out `input_tokens_details`.
      input_tokens_details: v.optional(
        v.object({
          cached_tokens: v.optional(TOKEN_COUNT),
          cache_write_tokens: v.optional(TOKEN_COUNT),
        }),
      ),
      output_tokens_details: v.optional(v.object({ reasoning_tokens: v.optional(TOKEN_COUNT) })),
    }),
  ),
  service_tier: v.optional(orNull(v.picklist(RESPONSES_SERVICE_TIERS.values))),
})
// biome-ignore-end lint/style/useNamingConvention: OpenAI's wire names.

function readUsage(usage: JsonObject | undefined): Usage | undefined {
  if (usage === undefined) {
    return undefined
  }
  const input = readObject(usage, 'input_tokens_details')
  const output = readObject(usage, 'output_tokens_details')
  return Object.freeze({
    input: readCount(usage, 'input_tokens'),
    output: readCount(usage, 'output_tokens'),
    total: readCount(usage, 'total_tokens'),
    cacheRead: input === undefined ? undefined : readCount(input, 'cached_tokens'),
    cacheCreation: input === undefined ? undefined : readCount(input, 'cache_write_tokens'),
    reasoning: output === undefined ? undefined : readCount(output, 'reasoning_tokens'),
  })
}

function itemsOfType(items: readonly JsonObject[], type: string): readonly JsonObject[] {
  return items.filter((item) => readString(item, 'type') === type)
}

function readText(items: readonly JsonObject[]): string | undefined {
  const parts = itemsOfType(items, 'message').flatMap((message) =>
    itemsOfType(objectsIn(readArray(message, 'content')), 'output_text'),
  )
  return joinTexts(parts.map((part) => readString(part, 'text')))
}

function readReasoning(item: JsonObject): ReasoningItem {
  const summary = itemsOfType(objectsIn(readArray(item, 'summary')), 'summary_text')
    .map((part) => readString(part, 'text'))
    .filter((text) => text !== undefined)
  return Object.freeze({
    kind: 'reasoning',
    id: readString(item, 'id'),
    summary: Object.freeze(summary),
    encryptedContent: readNullableString(item, 'encrypted_content'),
  })
}

/** Why an incomplete response stopped when it says, else how it ended. */
function readStopReason(body: JsonObject): string | undefined {
  const incomplete = readObject(body, 'incomplete_details')
  return (
    (incomplete === undefined ? undefined : readString(incomplete, 'reason')) ??
    readString(body, 'status')
  )
}

function readGeneration(body: unknown): Generation | undefined {
  if (
    !isJsonObject(body) ||
    (member(body, 'object') !== 'response' && readArray(body, 'output') === undefined)
  ) {
    return undefined
  }
  const items = objectsIn(readArray(body, 'output'))
  return Object.freeze({
    protocol: 'openai-responses',
    id: readString(body, 'id'),
    model: readString(body, 'model'),
    text: readText(items),
    stopReason: readStopReason(body),
    usage: readUsage(readObject(body, 'usage')),
    reasoning: Object.freeze(itemsOfType(items, 'reasoning').map(readReasoning)),
    systemFingerprint: undefined,
    serviceTier: readNullableString(body, 'service_tier'),
    deviations: deviationsFrom(RESPONSE, body),
  })
}

export const openaiResponses: ProtocolAdapter = Object.freeze({
  protocol: 'openai-responses',
  generatePath: 'responses',
  authSchemes: OPENAI_AUTH_SCHEMES,
  headers: openaiHeaders,
  readGeneration,
})
