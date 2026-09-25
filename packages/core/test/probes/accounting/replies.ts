/**
 * Generations shaped the way each protocol's own API returns them, for the
 * accounting and tokenizer probes: every field those probes read can be
 * replaced, or left out with `OMIT`.
 */

import type { Exchange, ProbeRequest } from '../../../src/probes/types.js'
import type { Protocol } from '../../../src/types/target.js'
import { jsonExchange, type ProbeAnswer, sentJson } from '../../fakes/context.js'

export const OMIT = Symbol('omit')
type Omittable<T> = T | typeof OMIT

export interface ReplyFields {
  readonly id?: Omittable<string>
  readonly model?: Omittable<string>
  readonly text?: string
  readonly stop?: Omittable<string | null>
  /** The usage object as JSON text, in the protocol's own field names. */
  readonly usage?: Omittable<string>
  /** Chat Completions only. */
  readonly fingerprint?: Omittable<string | null>
}

export const CHAT_ID = 'chatcmpl-B9MHDbslfkBeAs8l4bebGdFOJ6PeG'
export const RESPONSE_ID = 'resp_67ccd2bed1ec8190b14f964abc0542670a1b2c3d4e5f6071'

const DEFAULTS: Readonly<Record<Protocol, Required<ReplyFields>>> = Object.freeze({
  'anthropic-messages': {
    id: 'msg_013Zva2CMHLNnXjNJJKqJ2EF',
    model: 'claude-opus-5-5',
    text: 'Ocean',
    stop: 'max_tokens',
    usage: '{"input_tokens":312,"output_tokens":1}',
    fingerprint: OMIT,
  },
  'openai-chat': {
    id: CHAT_ID,
    model: 'gpt-5-2025-08-07',
    text: 'Ocean',
    stop: 'length',
    usage: '{"prompt_tokens":300,"completion_tokens":1,"total_tokens":301}',
    fingerprint: 'fp_50cad350e4',
  },
  'openai-responses': {
    id: RESPONSE_ID,
    model: 'gpt-5-2025-08-07',
    text: 'Ocean tides rise and fall twice a day as the Moon',
    stop: 'max_output_tokens',
    usage: '{"input_tokens":300,"output_tokens":16,"total_tokens":316}',
    fingerprint: OMIT,
  },
})

type Json = Record<string, unknown>

function present(body: Json): Json {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== OMIT))
}

function usageOf(usage: Omittable<string>): unknown {
  return usage === OMIT ? OMIT : JSON.parse(usage)
}

// biome-ignore-start lint/style/useNamingConvention: the vendors' wire names.
function bodyOf(protocol: Protocol, fields: Required<ReplyFields>): Json {
  const { id, model, text, stop, usage, fingerprint } = fields
  switch (protocol) {
    case 'anthropic-messages':
      return present({
        type: 'message',
        id,
        model,
        role: 'assistant',
        content: [{ type: 'text', text }],
        stop_reason: stop,
        usage: usageOf(usage),
      })
    case 'openai-chat':
      return present({
        id,
        object: 'chat.completion',
        created: 1_758_000_000,
        model,
        system_fingerprint: fingerprint,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: stop }],
        usage: usageOf(usage),
      })
    case 'openai-responses': {
      const isIncomplete = typeof stop === 'string' && stop !== 'completed'
      return present({
        id,
        object: 'response',
        model,
        status: isIncomplete ? 'incomplete' : 'completed',
        incomplete_details: isIncomplete ? { reason: stop } : null,
        output: [
          {
            type: 'message',
            id: 'msg_67ccd2bf17f0819081ff3bb2cf6508e6',
            role: 'assistant',
            content: [{ type: 'output_text', text }],
          },
        ],
        usage: usageOf(usage),
      })
    }
  }
}

/** Usage that reports `input` tokens in, and the output limit out. */
export function usageWith(protocol: Protocol, input: number): string {
  switch (protocol) {
    case 'anthropic-messages':
      return JSON.stringify({ input_tokens: input, output_tokens: 1 })
    case 'openai-chat':
      return JSON.stringify({
        prompt_tokens: input,
        completion_tokens: 1,
        total_tokens: input + 1,
      })
    case 'openai-responses':
      return JSON.stringify({ input_tokens: input, output_tokens: 16, total_tokens: input + 16 })
  }
}
// biome-ignore-end lint/style/useNamingConvention: the vendors' wire names.

/** A generation in `protocol`, with `fields` replacing the genuine defaults. */
export function reply(protocol: Protocol, fields: ReplyFields = {}): Exchange {
  return jsonExchange(200, bodyOf(protocol, { ...DEFAULTS[protocol], ...fields }))
}

/** The prompt a generation request carries. */
export function promptOf(request: ProbeRequest): string {
  const body = sentJson(request) as { messages?: { content: string }[]; input?: string }
  const prompt = body.messages?.[0]?.content ?? body.input
  if (prompt === undefined) {
    throw new TypeError('The request carries no prompt')
  }
  return prompt
}

/**
 * An endpoint that answers every generation in `protocol` with the input
 * count `count` gives its prompt, or no usage when `count` gives `undefined`.
 */
export function countingEndpoint(
  protocol: Protocol,
  count: (prompt: string) => number | undefined,
): ProbeAnswer {
  return (request) => {
    const input = count(promptOf(request))
    return reply(protocol, { usage: input === undefined ? OMIT : usageWith(protocol, input) })
  }
}

/** What Snowflake Cortex answers GPT-5.1 and later when asked for one output token. */
export const ONE_TOKEN_REFUSAL = jsonExchange(400, {
  message: 'invalid request parameters: invalid request',
})

/** The output limit a generation request sets, in whichever protocol's field it uses. */
export function limitOf(request: ProbeRequest | undefined): unknown {
  const body = sentJson(request) as Record<string, unknown> | undefined
  return body?.max_tokens ?? body?.max_completion_tokens ?? body?.max_output_tokens
}

/** `answer` behind a platform that refuses an output limit of one token with a 400. */
export function refusingOneToken(answer: ProbeAnswer): ProbeAnswer {
  return (request, index) => (limitOf(request) === 1 ? ONE_TOKEN_REFUSAL : answer(request, index))
}
