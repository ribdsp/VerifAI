/**
 * OpenAI's edge, as the conformance probes expect to find it: its error
 * envelope laid out the way each route lays it out, and an answerer that
 * replies by method and path, since some probes send in parallel.
 */

import type { NoKeyRoute } from '../../../../src/probes/conformance/openai/shared.js'
import type { Exchange, ProbeRequest } from '../../../../src/probes/types.js'
import type { HeaderPair } from '../../../../src/transport/types.js'
import { exchange, type ProbeAnswer } from '../../../fakes/context.js'

const JSON_TYPE: HeaderPair = ['Content-Type', 'application/json']

export interface ErrorFields {
  readonly type?: string
  readonly param?: string | null
  readonly code?: string | null
}

/** OpenAI's error envelope as text: compact when `indent` is 0, pretty-printed otherwise. */
export function errorText(message: string, indent = 0, fields: ErrorFields = {}): string {
  const body = {
    error: { message, type: 'invalid_request_error', param: null, code: null, ...fields },
  }
  return indent === 0 ? JSON.stringify(body) : `${JSON.stringify(body, null, indent)}\n`
}

/** A JSON response whose body is `text` byte for byte. */
export function jsonText(
  status: number,
  text: string,
  headers: readonly HeaderPair[] = [],
): Exchange {
  return exchange(status, text, [JSON_TYPE, ...headers])
}

/** An OpenAI-envelope error, compact. */
export function openaiErrorExchange(
  status: number,
  message: string,
  fields: ErrorFields = {},
): Exchange {
  return jsonText(status, errorText(message, 0, fields))
}

export const LEGACY_MESSAGE =
  "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth."

export const EDGE_401_TEXT: Readonly<Record<NoKeyRoute, string>> = Object.freeze({
  'get-models': errorText('Missing bearer authentication in header', 2),
  'get-chat-completions': errorText('Missing bearer or basic authentication in header'),
  'post-chat-completions': errorText(LEGACY_MESSAGE, 4),
  'post-responses': errorText('Missing bearer or basic authentication in header', 2),
})

/** The 401 OpenAI's edge sends on `route` without a key. */
export function edge401(route: NoKeyRoute, headers: readonly HeaderPair[] = []): Exchange {
  return jsonText(401, EDGE_401_TEXT[route], headers)
}

export const ROUTE_KEYS: Readonly<Record<NoKeyRoute, string>> = Object.freeze({
  'get-models': 'GET models',
  'get-chat-completions': 'GET chat/completions',
  'post-chat-completions': 'POST chat/completions',
  'post-responses': 'POST responses',
})

/** `GET models`; a request without a method is a POST, as every generation is. */
export function keyOf(request: ProbeRequest): string {
  return `${request.method ?? 'POST'} ${request.path}`
}

/** Answers by `keyOf`, and with an empty 404 for anything else. */
export function byRoute(answers: Readonly<Record<string, Exchange>>): ProbeAnswer {
  return (request) => answers[keyOf(request)] ?? exchange(404)
}

/** The unrouted path the shared not-found request asks for, at the fake context's nonce. */
export const UNROUTED_KEY = 'GET nonexistent-n0nce7test'
