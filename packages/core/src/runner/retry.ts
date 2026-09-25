/**
 * When a failed request is worth sending again, and how long to wait first.
 *
 * One busy moment must not become a finding about a business, so a transient
 * failure is retried once. Only once: an endpoint that fails the same request
 * twice has failed it, and a runner that kept trying would spend the buyer's
 * budget on an endpoint that is telling it something.
 */

import { headerValue } from '../transport/headers.js'
import type { HeaderPair, TransportFailureKind } from '../transport/types.js'

/** Waited when a transient failure asks for no particular delay. */
export const DEFAULT_RETRY_WAIT_MS = 1000

/**
 * The longest `retry-after` honoured. An endpoint that asks for longer is not
 * retried: the request is lost, which is what an endpoint that cannot answer
 * inside half a minute has done.
 */
export const MAX_RETRY_WAIT_MS = 30_000

const TRANSIENT_FAILURES: ReadonlySet<TransportFailureKind> = new Set([
  'timeout',
  'connection-failed',
  'unreadable-response',
])

/** 408, 429, and every 5xx - Anthropic's 529 `overloaded_error` included. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

export function isTransientFailure(kind: TransportFailureKind): boolean {
  return TRANSIENT_FAILURES.has(kind)
}

const DELAY_SECONDS = /^\d+(?:\.\d+)?$/

/**
 * The wait a response asked for, per RFC 9110 section 10.2.3: a number of
 * seconds or an HTTP date. `undefined` when it asked for longer than
 * `MAX_RETRY_WAIT_MS`.
 *
 * @param nowMs The wall clock, for the date form.
 */
export function retryWaitMs(headers: readonly HeaderPair[], nowMs: number): number | undefined {
  const value = headerValue(headers, 'retry-after')?.trim()
  if (value === undefined || value === '') {
    return DEFAULT_RETRY_WAIT_MS
  }
  let waitMs: number
  if (DELAY_SECONDS.test(value)) {
    waitMs = Number(value) * 1000
  } else {
    const at = Date.parse(value)
    if (Number.isNaN(at)) {
      return DEFAULT_RETRY_WAIT_MS
    }
    waitMs = Math.max(0, at - nowMs)
  }
  return waitMs > MAX_RETRY_WAIT_MS ? undefined : Math.ceil(waitMs)
}
