/**
 * The adapters by protocol, and the one way a probe turns what it wants to
 * send into a `TransportRequest`.
 *
 * Probes send malformed requests on purpose - a wrong `anthropic-version`, a
 * body that is not JSON, no credential at all - so everything an adapter adds
 * by default can be replaced or left out. What cannot be bypassed is the
 * credential check: a key goes into a header verbatim, so it is normalised
 * here, and a key that is not a run of visible ASCII never reaches the wire.
 */

import { normaliseApiKey } from '../credentials/api-key.js'
import { assertSendableHeaders } from '../transport/headers.js'
import type { HeaderPair, HttpMethod, TransportRequest } from '../transport/types.js'
import { PROTOCOLS, type Protocol } from '../types/target.js'
import { anthropicMessages } from './anthropic-messages.js'
import { type Endpoint, operationUrl } from './endpoint.js'
import { openaiChat } from './openai-chat.js'
import { openaiResponses } from './openai-responses.js'
import type { AuthScheme, ProtocolAdapter } from './types.js'

const ADAPTERS: Readonly<Record<Protocol, ProtocolAdapter>> = Object.freeze({
  'anthropic-messages': anthropicMessages,
  'openai-chat': openaiChat,
  'openai-responses': openaiResponses,
})

/**
 * @throws TypeError for anything that is not one of `PROTOCOLS`, for the
 * reason `protocolOwner` does: protocols arrive from flags, HTTP bodies and
 * fixtures, and an `undefined` adapter would fail far from its cause.
 */
export function adapterFor(protocol: Protocol): ProtocolAdapter {
  if (!PROTOCOLS.has(protocol)) {
    throw new TypeError(
      `Unknown protocol ${JSON.stringify(protocol)}; expected one of ${PROTOCOLS.values.join(', ')}`,
    )
  }
  return ADAPTERS[protocol]
}

/**
 * The scheme the buyer chose when `adapter` documents it, and the adapter's
 * own first otherwise. A buyer's choice is made for the target's protocol; a
 * probe that speaks another one still sends the key in a way that protocol
 * takes.
 */
export function authFor(adapter: ProtocolAdapter, preferred: AuthScheme | undefined): AuthScheme {
  return preferred !== undefined && adapter.authSchemes.includes(preferred)
    ? preferred
    : adapter.authSchemes[0]
}

/** How the buyer's key travels to a target: `authFor` over the target's own protocol. */
export function targetAuth(target: {
  readonly protocol: Protocol
  readonly auth?: AuthScheme
}): AuthScheme {
  return authFor(adapterFor(target.protocol), target.auth)
}

/** A value to send as JSON, or bytes to send exactly, such as a body that is not JSON. */
export type RequestBody = { readonly json: unknown } | { readonly bytes: Uint8Array }

export interface RequestSpec {
  readonly endpoint: Endpoint
  /** An adapter's operation path, or `modelPath(id)`. Never raw user input. */
  readonly path: string
  /** `POST` with a body, `GET` without. */
  readonly method?: HttpMethod
  /** As the buyer supplied it. Omitted for a probe that deliberately sends no key. */
  readonly apiKey?: string
  /** The adapter's first scheme when omitted. */
  readonly auth?: AuthScheme
  readonly body?: RequestBody
  /**
   * Sent after the adapter's defaults, in this order and casing. A default
   * with the same name, compared case-insensitively, is dropped in favour of
   * these; repeating a name here sends it repeatedly.
   *
   * Written by probe code, never taken from the buyer. A probe that replaces
   * the credential header on purpose - a malformed `Authorization` - sends a
   * value it chose, which is checked as a header, not as a key; the buyer's key
   * only ever travels as `apiKey`.
   */
  readonly headers?: readonly HeaderPair[]
  /** Defaults to leave out, by name, compared case-insensitively. */
  readonly withoutHeaders?: readonly string[]
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
  readonly signal?: AbortSignal
}

const encoder = new TextEncoder()

function encodeBody(body: RequestBody): Uint8Array {
  if ('bytes' in body) {
    // A typed array cannot be frozen; a copy keeps the caller's later writes off the wire.
    return body.bytes.slice()
  }
  const text: unknown = JSON.stringify(body.json)
  if (typeof text !== 'string') {
    throw new TypeError('A JSON request body must be a value JSON can represent')
  }
  return encoder.encode(text)
}

/** @throws TypeError naming the problem, never the key. */
function normalisedKey(apiKey: string | undefined): string | undefined {
  if (apiKey === undefined) {
    return undefined
  }
  const result = normaliseApiKey(apiKey)
  if (!result.ok) {
    throw new TypeError(`The API key cannot be sent: ${result.problem}`)
  }
  return result.key
}

function mergeHeaders(
  defaults: readonly HeaderPair[],
  overrides: readonly HeaderPair[],
  without: readonly string[],
): readonly HeaderPair[] {
  const replaced = new Set([
    ...overrides.map(([name]) => name.toLowerCase()),
    ...without.map((name) => name.toLowerCase()),
  ])
  return Object.freeze([
    ...defaults.filter(([name]) => !replaced.has(name.toLowerCase())),
    ...overrides.map((pair): HeaderPair => Object.freeze([pair[0], pair[1]])),
  ])
}

/**
 * @throws TypeError for a key that cannot be sent, an auth scheme the protocol
 * does not document, a body JSON cannot represent, or a header the transport
 * would refuse. Every message names the problem and nothing the buyer typed.
 */
export function buildRequest(adapter: ProtocolAdapter, spec: RequestSpec): TransportRequest {
  const body = spec.body === undefined ? undefined : encodeBody(spec.body)
  const defaults = adapter.headers({
    apiKey: normalisedKey(spec.apiKey),
    auth: spec.auth ?? adapter.authSchemes[0],
    hasBody: body !== undefined,
  })
  const headers = mergeHeaders(defaults, spec.headers ?? [], spec.withoutHeaders ?? [])
  assertSendableHeaders(headers)

  return Object.freeze({
    method: spec.method ?? (body === undefined ? 'GET' : 'POST'),
    url: operationUrl(spec.endpoint, spec.path),
    headers,
    ...(body === undefined ? {} : { body }),
    ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
    ...(spec.maxResponseBytes === undefined ? {} : { maxResponseBytes: spec.maxResponseBytes }),
    ...(spec.signal === undefined ? {} : { signal: spec.signal }),
  })
}
