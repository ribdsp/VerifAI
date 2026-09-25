/**
 * Anthropic's Messages API, per https://platform.claude.com/docs/en/api/messages/create
 * as published on 2026-09-24.
 */

import * as v from 'valibot'
import type { HeaderPair } from '../transport/types.js'
import { type Member, vocabulary } from '../types/vocabulary.js'
import { deviationsFrom, openVariant, orNull, TOKEN_COUNT } from './conformance.js'
import {
  isJsonObject,
  type JsonObject,
  joinTexts,
  objectsIn,
  readArray,
  readCount,
  readNullableString,
  readObject,
  readString,
} from './json.js'
import { credentialHeaders, JSON_ACCEPT, JSON_CONTENT_TYPE } from './request-headers.js'
import type {
  AuthSchemes,
  Generation,
  HeaderOptions,
  ProtocolAdapter,
  ReasoningItem,
  Usage,
} from './types.js'

/** The only version the documentation's examples send. */
export const ANTHROPIC_VERSION = '2023-06-01'

export const ANTHROPIC_COUNT_TOKENS_PATH = 'messages/count_tokens'

/**
 * As documented on 2026-09-24. A reason Anthropic adds later reads as a
 * deviation until this list follows it.
 */
export const ANTHROPIC_STOP_REASONS = vocabulary([
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
  'pause_turn',
  'refusal',
  'model_context_window_exceeded',
])
export type AnthropicStopReason = Member<typeof ANTHROPIC_STOP_REASONS>

/**
 * The documentation leads with `Authorization: Bearer` and keeps `x-api-key`
 * as the older header. `x-api-key` is the default all the same, because it is
 * what the vendor's own curl example sends and what every Messages-compatible
 * gateway accepts; a gateway that only honours Bearer is reached with
 * `auth: 'bearer'`.
 */
const ANTHROPIC_AUTH_SCHEMES: AuthSchemes = Object.freeze(['x-api-key', 'bearer'] as const)

/** "Tool use ID" in the documentation, with this pattern. */
const TOOL_USE_ID = /^[a-zA-Z0-9_-]+$/

// biome-ignore-start lint/style/useNamingConvention: Anthropic's wire names.
const MESSAGE = v.object({
  id: v.string(),
  type: v.literal('message'),
  role: v.literal('assistant'),
  model: v.string(),
  content: v.array(
    openVariant('type', {
      text: { text: v.string() },
      thinking: { thinking: v.string(), signature: v.string() },
      redacted_thinking: { data: v.string() },
      tool_use: {
        id: v.pipe(v.string(), v.regex(TOOL_USE_ID)),
        name: v.string(),
        input: v.record(v.string(), v.unknown()),
      },
    }),
  ),
  // "In non-streaming mode this value is always non-null."
  stop_reason: v.picklist(ANTHROPIC_STOP_REASONS.values),
  stop_sequence: orNull(v.string()),
  usage: v.object({
    input_tokens: TOKEN_COUNT,
    output_tokens: TOKEN_COUNT,
    cache_creation_input_tokens: v.optional(orNull(TOKEN_COUNT)),
    cache_read_input_tokens: v.optional(orNull(TOKEN_COUNT)),
    output_tokens_details: v.optional(
      v.nullable(v.object({ thinking_tokens: v.optional(TOKEN_COUNT) })),
    ),
    service_tier: v.optional(orNull(v.picklist(['standard', 'priority', 'batch']))),
  }),
})
// biome-ignore-end lint/style/useNamingConvention: Anthropic's wire names.

const VERSION_HEADER: HeaderPair = Object.freeze(['anthropic-version', ANTHROPIC_VERSION])

function headers({ apiKey, auth, hasBody }: HeaderOptions): readonly HeaderPair[] {
  return Object.freeze([
    ...(hasBody ? [JSON_CONTENT_TYPE] : []),
    JSON_ACCEPT,
    VERSION_HEADER,
    ...credentialHeaders(ANTHROPIC_AUTH_SCHEMES, auth, apiKey),
  ])
}

function readUsage(usage: JsonObject | undefined): Usage | undefined {
  if (usage === undefined) {
    return undefined
  }
  const details = readObject(usage, 'output_tokens_details')
  return Object.freeze({
    input: readCount(usage, 'input_tokens'),
    output: readCount(usage, 'output_tokens'),
    total: undefined,
    cacheRead: readCount(usage, 'cache_read_input_tokens'),
    cacheCreation: readCount(usage, 'cache_creation_input_tokens'),
    reasoning: details === undefined ? undefined : readCount(details, 'thinking_tokens'),
  })
}

function readReasoning(block: JsonObject): ReasoningItem | undefined {
  switch (readString(block, 'type')) {
    case 'thinking':
      return Object.freeze({
        kind: 'thinking',
        text: readString(block, 'thinking'),
        signature: readString(block, 'signature'),
      })
    case 'redacted_thinking':
      return Object.freeze({ kind: 'redacted-thinking', data: readString(block, 'data') })
    default:
      return undefined
  }
}

function readGeneration(body: unknown): Generation | undefined {
  if (
    !isJsonObject(body) ||
    (readString(body, 'type') !== 'message' && readArray(body, 'content') === undefined)
  ) {
    return undefined
  }
  const blocks = objectsIn(readArray(body, 'content'))
  const usage = readObject(body, 'usage')
  return Object.freeze({
    protocol: 'anthropic-messages',
    id: readString(body, 'id'),
    model: readString(body, 'model'),
    text: joinTexts(
      blocks
        .filter((block) => readString(block, 'type') === 'text')
        .map((block) => readString(block, 'text')),
    ),
    stopReason: readNullableString(body, 'stop_reason'),
    usage: readUsage(usage),
    reasoning: Object.freeze(blocks.map(readReasoning).filter((item) => item !== undefined)),
    systemFingerprint: undefined,
    serviceTier: usage === undefined ? undefined : readNullableString(usage, 'service_tier'),
    deviations: deviationsFrom(MESSAGE, body),
  })
}

export const anthropicMessages: ProtocolAdapter = Object.freeze({
  protocol: 'anthropic-messages',
  generatePath: 'messages',
  authSchemes: ANTHROPIC_AUTH_SCHEMES,
  headers,
  readGeneration,
})
