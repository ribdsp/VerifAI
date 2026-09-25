/**
 * Anthropic's edge, as the conformance probes expect to find it: its error
 * envelope, a model object, a successful message, and an answerer that replies
 * by what a request body sets.
 */

import type { Exchange, ProbeRequest } from '../../../../src/probes/types.js'
import type { HeaderPair } from '../../../../src/transport/types.js'
import { exchange, jsonExchange, type ProbeAnswer, sentJson } from '../../../fakes/context.js'

const JSON_TYPE: HeaderPair = ['Content-Type', 'application/json']

export const REQUEST_ID = 'req_018EeWyXxfu5pfWkrYcMdjWG'

/** Anthropic's error envelope as text, with a `request_id` unless it is `null`. */
export function anthropicErrorText(
  type: string,
  message: string,
  requestId: string | null = REQUEST_ID,
): string {
  const id = requestId === null ? '' : `,"request_id":${JSON.stringify(requestId)}`
  return `{"type":"error","error":{"type":${JSON.stringify(type)},"message":${JSON.stringify(message)}}${id}}`
}

export interface ErrorOptions {
  /** `null` leaves the field out. */
  readonly requestId?: string | null
  readonly headers?: readonly HeaderPair[]
}

/** A response whose body is `text` byte for byte, with a JSON content type. */
export function jsonText(
  status: number,
  text: string,
  headers: readonly HeaderPair[] = [],
): Exchange {
  return exchange(status, text, [JSON_TYPE, ...headers])
}

export function anthropicError(
  status: number,
  type: string,
  message: string,
  options: ErrorOptions = {},
): Exchange {
  const requestId = options.requestId === undefined ? REQUEST_ID : options.requestId
  return jsonText(status, anthropicErrorText(type, message, requestId), options.headers)
}

/** The 400 Anthropic documents for a request shape a model does not take. */
export function invalidRequest(message: string, options: ErrorOptions = {}): Exchange {
  return anthropicError(400, 'invalid_request_error', message, options)
}

export function openaiError(status: number, message: string): Exchange {
  return jsonExchange(status, {
    error: { message, type: 'invalid_request_error', param: null, code: null },
  })
}

export function messageOk(): Exchange {
  return jsonText(
    200,
    '{"id":"msg_01","type":"message","role":"assistant","model":"claude-opus-5-5","content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn"}',
  )
}

const MODEL_OBJECT =
  '{"type":"model","id":"claude-opus-5-5","display_name":"Claude Opus 5.5","created_at":"2026-05-01T00:00:00Z","capabilities":null,"max_input_tokens":1000000,"max_tokens":128000}'

/** A model object as the Models API documents it, with `overrides` as JSON text merged in. */
export function modelObject(overrides = '{}'): Record<string, unknown> {
  return { ...JSON.parse(MODEL_OBJECT), ...JSON.parse(overrides) }
}

/** Replies by what the request body sets, so each matrix cell gets its own answer. */
export function byBody(reply: (body: Record<string, unknown>) => Exchange): ProbeAnswer {
  return (request: ProbeRequest) => reply((sentJson(request) ?? {}) as Record<string, unknown>)
}
