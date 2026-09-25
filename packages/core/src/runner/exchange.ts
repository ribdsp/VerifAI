/**
 * A transport's answer turned into what a probe reads, and into what the
 * report keeps of it.
 */

import { createRedactor } from '../credentials/redact.js'
import type { Exchange } from '../probes/types.js'
import { readJsonBody } from '../transport/json-body.js'
import type { TransportRequest, TransportResponse } from '../transport/types.js'

const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

function textOf(body: Uint8Array): string | undefined {
  try {
    return decoder.decode(body)
  } catch {
    // Under `fatal` the only failure is malformed UTF-8, which is what `undefined` says.
    return undefined
  }
}

export function toExchange(response: TransportResponse, retried: boolean): Exchange {
  return Object.freeze({
    status: response.status,
    statusText: response.statusText,
    httpVersion: response.httpVersion,
    headers: response.headers,
    body: response.body,
    text: textOf(response.body),
    json: readJsonBody(response.body),
    chunks: response.chunks,
    timing: response.timing,
    connection: response.connection,
    retried,
  })
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** `sha256:<hex>`, the one digest format the report uses. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  // A copy, so the digest reads an `ArrayBuffer` whatever backs the caller's view.
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice())
  return `sha256:${hex(digest)}`
}

export function sha256Text(text: string): Promise<string> {
  return sha256(encoder.encode(text))
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * Over the method, URL, every header in order, and the body - with the key
 * redacted out of every header value first, so the digest of two runs with
 * different keys is the same and neither digest is a function of the key.
 */
export function requestDigest(
  request: TransportRequest,
  secrets: readonly string[],
): Promise<string> {
  const redact = createRedactor(secrets)
  const head = [
    `${request.method} ${request.url}`,
    ...request.headers.map(([name, value]) => `${name}: ${redact(value)}`),
    '',
    '',
  ].join('\r\n')
  return sha256(concat([encoder.encode(head), request.body ?? new Uint8Array(0)]))
}
