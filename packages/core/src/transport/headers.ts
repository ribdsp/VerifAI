/**
 * Header pairs: lookup, conversion from Node's flat list, and the checks a
 * request's headers must pass before any byte is written.
 */

import type { HeaderPair } from './types.js'

/** RFC 9110 `token`: the characters a field name may contain. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/**
 * RFC 9110 `field-value`, minus obs-text: visible ASCII, space and tab. CR and
 * LF are what split one header into two, and NUL truncates in some parsers.
 */
const FIELD_VALUE = /^[\t\x20-\x7e]*$/

const RESERVED: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
])

/**
 * @throws TypeError naming the offending header. Never the value: the value is
 * usually a credential, and error messages are rendered output.
 */
export function assertSendableHeaders(headers: readonly HeaderPair[]): void {
  for (const [name, value] of headers) {
    if (!TOKEN.test(name)) {
      throw new TypeError(`Header name ${JSON.stringify(name)} is not a valid HTTP token`)
    }
    if (RESERVED.has(name.toLowerCase())) {
      throw new TypeError(`Header ${name} is reserved for the transport`)
    }
    if (!FIELD_VALUE.test(value)) {
      throw new TypeError(`Header ${name} has a value containing a forbidden character`)
    }
  }
}

export function headerValues(headers: readonly HeaderPair[], name: string): readonly string[] {
  const wanted = name.toLowerCase()
  return headers.filter(([candidate]) => candidate.toLowerCase() === wanted).map(([, v]) => v)
}

export function headerValue(headers: readonly HeaderPair[], name: string): string | undefined {
  return headerValues(headers, name)[0]
}

/** Node's `rawHeaders`: `[name, value, name, value, ...]`, casing and repeats intact. */
export function pairsFromRawHeaders(raw: readonly string[]): readonly HeaderPair[] {
  if (raw.length % 2 !== 0) {
    throw new TypeError('Raw header list has a name without a value')
  }

  const pairs: HeaderPair[] = []
  for (let at = 0; at < raw.length; at += 2) {
    pairs.push(Object.freeze([raw[at] ?? '', raw[at + 1] ?? ''] as const))
  }
  return Object.freeze(pairs)
}
