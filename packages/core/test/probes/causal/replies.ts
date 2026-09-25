/**
 * Responses for the Group D probes, shaped the way each vendor's API returns
 * them, and readers for what the probes sent.
 */

import type { Exchange, Probe, ProbeRequest } from '../../../src/probes/types.js'
import { type FakeContext, jsonExchange, sentJson } from '../../fakes/context.js'

type Json = Record<string, unknown>

export interface MessageFields {
  readonly content?: readonly Json[]
  readonly stop?: string
  readonly usage?: Json
}

// biome-ignore-start lint/style/useNamingConvention: the vendors' wire names.
/** An Anthropic Messages response. */
export function message(fields: MessageFields = {}): Exchange {
  return jsonExchange(200, {
    type: 'message',
    id: 'msg_013Zva2CMHLNnXjNJJKqJ2EF',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: fields.content ?? [{ type: 'text', text: 'ok' }],
    stop_reason: fields.stop ?? 'end_turn',
    stop_sequence: null,
    usage: fields.usage ?? { input_tokens: 20, output_tokens: 1 },
  })
}

/** A reply to a prompt marked for caching, with Anthropic's three input counts. */
export function cached(input: number, read: number, written: number): Exchange {
  return message({
    usage: {
      input_tokens: input,
      cache_creation_input_tokens: written,
      cache_read_input_tokens: read,
      output_tokens: 1,
    },
  })
}

/** An Anthropic error body. */
export function anthropicError(status: number, text: string): Exchange {
  return jsonExchange(status, {
    type: 'error',
    error: { type: 'invalid_request_error', message: text },
  })
}

export interface ChatFields {
  readonly finish?: string
  /** The choice's `logprobs` member; left out when `undefined`. */
  readonly logprobs?: unknown
}

/** An OpenAI Chat Completions response. */
export function chat(content: string, fields: ChatFields = {}): Exchange {
  return jsonExchange(200, {
    id: 'chatcmpl-B9MHDbslfkBeAs8l4bebGdFOJ6PeG',
    object: 'chat.completion',
    created: 1_758_000_000,
    model: 'gpt-4o-2024-08-06',
    system_fingerprint: 'fp_50cad350e4',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: fields.finish ?? 'stop',
        ...(fields.logprobs === undefined ? {} : { logprobs: fields.logprobs }),
      },
    ],
    usage: { prompt_tokens: 30, completion_tokens: 2, total_tokens: 32 },
  })
}

/** An OpenAI Responses response. */
export function responsesReply(text: string, status = 'completed'): Exchange {
  return jsonExchange(200, {
    id: 'resp_67ccd2bed1ec8190b14f964abc0542670a1b2c3d4e5f6071',
    object: 'response',
    model: 'gpt-5-2025-08-07',
    status,
    incomplete_details: status === 'completed' ? null : { reason: 'max_output_tokens' },
    output: [
      {
        type: 'message',
        id: 'msg_67ccd2bf17f0819081ff3bb2cf6508e6',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    ],
    usage: { input_tokens: 40, output_tokens: 12, total_tokens: 52 },
  })
}
// biome-ignore-end lint/style/useNamingConvention: the vendors' wire names.

/** The JSON body a probe sent, as an object. */
export function bodyOf(request: ProbeRequest | undefined): Json {
  const body = sentJson(request)
  if (typeof body !== 'object' || body === null) {
    throw new TypeError('The request carries no JSON body')
  }
  return body as Json
}

/** The text of the first user block of a request marked for caching. */
export function cachedTextOf(request: ProbeRequest): string {
  const messages = bodyOf(request).messages as { content: { text: string }[] }[]
  const text = messages[0]?.content[0]?.text
  if (text === undefined) {
    throw new TypeError('The request carries no cached block')
  }
  return text
}

/** Every request stays within the probe's declared cost. */
export function withinCost(probe: Probe, fake: FakeContext): boolean {
  const tokens = fake.requests.reduce((sum, request) => sum + (request.tokens ?? 0), 0)
  return fake.requests.length <= probe.cost.requests && tokens <= probe.cost.tokens
}
