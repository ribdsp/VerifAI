/**
 * An in-memory `Transport` for code that sits above the transport: adapters,
 * detection, probes. Nothing here touches a socket.
 *
 * The transport itself is tested against real loopback servers, because the
 * Tier-0 probes read header casing, order and byte-level whitespace that an
 * in-memory stand-in would have to invent. Above the transport those bytes are
 * already a `TransportResult`, so a fake that returns one loses nothing.
 */

import {
  type HeaderPair,
  type Transport,
  type TransportFailure,
  type TransportFailureKind,
  type TransportRequest,
  type TransportResponse,
  type TransportResult,
  transportFailure,
} from '../../src/transport/types.js'

export type Answer = (request: TransportRequest) => TransportResult | Promise<TransportResult>

export interface FakeTransport extends Transport {
  /** Every request sent so far, in the order `send` was called. */
  readonly requests: readonly TransportRequest[]
}

export function fakeTransport(answer: Answer): FakeTransport {
  const requests: TransportRequest[] = []
  return {
    get requests() {
      return Object.freeze([...requests])
    },
    send: async (request) => {
      requests.push(request)
      return answer(request)
    },
  }
}

const encoder = new TextEncoder()

export function response(
  status: number,
  body: string | Uint8Array = '',
  headers: readonly HeaderPair[] = [],
): TransportResponse {
  const bytes = typeof body === 'string' ? encoder.encode(body) : body
  return Object.freeze({
    ok: true,
    status,
    statusText: '',
    httpVersion: '1.1',
    headers: Object.freeze([...headers]),
    body: bytes,
    chunks: Object.freeze([Object.freeze({ atMs: 1, start: 0, end: bytes.length })]),
    connection: 'fresh',
    timing: Object.freeze({ startedMs: 0, headersMs: 1, completedMs: 1 }),
  })
}

/** `value` serialised compactly, with a JSON content type. */
export function jsonResponse(status: number, value: unknown): TransportResponse {
  return response(status, JSON.stringify(value), [['Content-Type', 'application/json']])
}

export function failure(kind: TransportFailureKind, sent = false): TransportFailure {
  return transportFailure(kind, {
    sent,
    connection: sent ? 'fresh' : 'unobserved',
    startedMs: 0,
    failedMs: 1,
  })
}

/** Answers by exact URL, and everything else with `fallback`: an empty 404 unless given. */
export function byUrl(
  table: Readonly<Record<string, TransportResult>>,
  fallback: TransportResult = response(404),
): Answer {
  return (request) =>
    Object.hasOwn(table, request.url) ? (table[request.url] ?? fallback) : fallback
}
