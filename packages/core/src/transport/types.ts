/**
 * The contract between probes and whatever carries their bytes.
 *
 * Probes judge endpoints on details a convenience client erases - header casing,
 * header order, duplicate headers, byte-level body whitespace, when each chunk of
 * a stream arrived - so a transport hands back the response exactly as it came
 * off the wire, and a request goes out exactly as a probe wrote it.
 *
 * Failures are the other half. A transport that surfaced raw socket errors would
 * let anyone driving VerifAI tell "refused" from "filtered" from "no such host",
 * which is a port scanner. So the transport's own failures collapse to a fixed
 * taxonomy with fixed messages that never carry an errno, an address or a port.
 * A response from an endpoint that passed the guard is different: it is
 * evidence, and it is never rewritten.
 */

import type { RefusedScope } from '../net/guard.js'
import { type Member, vocabulary } from '../types/vocabulary.js'

export const HTTP_METHODS = vocabulary(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
export type HttpMethod = Member<typeof HTTP_METHODS>

export const TRANSPORT_FAILURES = vocabulary([
  'blocked-target',
  'dns-failure',
  'connection-failed',
  'tls-failure',
  'timeout',
  'aborted',
  'response-too-large',
  'unreadable-response',
])
export type TransportFailureKind = Member<typeof TRANSPORT_FAILURES>

/**
 * Whether a request travelled on a connection of its own. Group F counts a
 * repetition as an independent draw only when every request in it was `fresh`,
 * because a router that pins a backend per connection would otherwise look
 * uniform. `unobserved` is for transports that cannot tell - `fetch` in a
 * browser - and for requests that failed before any connection existed.
 */
export const CONNECTION_REUSE = vocabulary(['fresh', 'reused', 'unobserved'])
export type ConnectionReuse = Member<typeof CONNECTION_REUSE>

/** One header as it appears on the wire: original casing, and repeated names kept apart. */
export type HeaderPair = readonly [name: string, value: string]

export interface TransportRequest {
  readonly method: HttpMethod
  readonly url: string
  /**
   * Sent in this order and casing. `Host`, `Content-Length`, `Transfer-Encoding`
   * and `Connection` belong to the transport: `Host` must name the host the
   * address was pinned for, and the framing headers must describe the body the
   * transport actually writes.
   */
  readonly headers: readonly HeaderPair[]
  readonly body?: Uint8Array
  /** For the whole exchange: resolution, connection, response and body. */
  readonly timeoutMs?: number
  /** After content decoding, so a compressed response cannot expand past it. */
  readonly maxResponseBytes?: number
  readonly signal?: AbortSignal
}

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/**
 * A slice of `body` and the moment it arrived. Streaming probes read time to
 * first token and throughput from these rather than from the whole-body time.
 */
export interface BodyChunk {
  readonly atMs: number
  readonly start: number
  readonly end: number
}

/** Readings of the transport's clock, in milliseconds. Only the differences mean anything. */
export interface ResponseTiming {
  readonly startedMs: number
  readonly headersMs: number
  readonly completedMs: number
}

export interface TransportResponse {
  readonly ok: true
  readonly status: number
  /** The reason phrase as sent, which proxies routinely rewrite. */
  readonly statusText: string
  readonly httpVersion: string
  readonly headers: readonly HeaderPair[]
  /**
   * Decoded per `Content-Encoding`. Typed arrays cannot be frozen; this one is
   * referenced by nothing else, and must be treated as read-only.
   */
  readonly body: Uint8Array
  readonly chunks: readonly BodyChunk[]
  readonly connection: ConnectionReuse
  readonly timing: ResponseTiming
}

export interface TransportFailure {
  readonly ok: false
  readonly kind: TransportFailureKind
  /** Fixed per kind. Safe to display: it cannot carry an address, a port or a key. */
  readonly message: string
  /**
   * The request reached the endpoint: a connection was established and the
   * request handed to it. A failure after that point is a lost answer rather
   * than a request that never happened, and Group F counts the two differently.
   */
  readonly sent: boolean
  readonly connection: ConnectionReuse
  /** For `blocked-target`: whether `--allow-private-targets` would have admitted it. */
  readonly blockedScope?: RefusedScope
  readonly timing: { readonly startedMs: number; readonly failedMs: number }
}

export type TransportResult = TransportResponse | TransportFailure

export interface Transport {
  /**
   * Resolves for every network outcome, including every failure in the
   * taxonomy. Rejects only for a malformed request, which is a bug in the
   * caller rather than a property of the endpoint.
   */
  readonly send: (request: TransportRequest) => Promise<TransportResult>
}

const FAILURE_MESSAGES: Readonly<Record<TransportFailureKind, string>> = Object.freeze({
  'blocked-target': 'VerifAI will not connect to this endpoint address.',
  'dns-failure': 'The endpoint hostname could not be resolved.',
  'connection-failed': 'Could not open a connection to the endpoint.',
  'tls-failure': 'The TLS handshake with the endpoint failed.',
  timeout: 'The endpoint did not finish answering within the time limit.',
  aborted: 'The request was cancelled.',
  'response-too-large': 'The endpoint sent more data than VerifAI accepts for one response.',
  'unreadable-response': 'The endpoint sent a response VerifAI could not read as HTTP.',
})

export interface FailureDetails {
  readonly sent: boolean
  readonly connection: ConnectionReuse
  readonly startedMs: number
  readonly failedMs: number
  readonly blockedScope?: RefusedScope
}

/** The only way to build a failure, so a message can never be anything but the fixed one. */
export function transportFailure(
  kind: TransportFailureKind,
  details: FailureDetails,
): TransportFailure {
  const base = {
    ok: false as const,
    kind,
    message: FAILURE_MESSAGES[kind],
    sent: details.sent,
    connection: details.connection,
    timing: Object.freeze({ startedMs: details.startedMs, failedMs: details.failedMs }),
  }
  return Object.freeze(
    kind === 'blocked-target' && details.blockedScope !== undefined
      ? { ...base, blockedScope: details.blockedScope }
      : base,
  )
}
