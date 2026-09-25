/**
 * A response body read as JSON, with the ways it can fail kept apart.
 *
 * "Empty", "not UTF-8" and "not JSON" are different findings - OpenAI answers
 * some unknown routes with a zero-byte 404, and a gateway's HTML error page is
 * something else again - so none of them collapses into a thrown `SyntaxError`.
 */

export type JsonBody =
  | { readonly kind: 'empty' }
  | { readonly kind: 'not-utf8' }
  | { readonly kind: 'not-json' }
  /** `value` is freshly parsed and referenced by nothing else; treat it as read-only. */
  | { readonly kind: 'json'; readonly value: unknown }

const EMPTY: JsonBody = Object.freeze({ kind: 'empty' })
const NOT_UTF8: JsonBody = Object.freeze({ kind: 'not-utf8' })
const NOT_JSON: JsonBody = Object.freeze({ kind: 'not-json' })

/**
 * `fatal`, so invalid UTF-8 is a finding rather than a U+FFFD that parses. A
 * leading byte order mark is dropped, which RFC 8259 section 8.1 allows a
 * parser to do.
 */
const decoder = new TextDecoder('utf-8', { fatal: true })

export function readJsonBody(body: Uint8Array): JsonBody {
  if (body.length === 0) {
    return EMPTY
  }

  let text: string
  try {
    text = decoder.decode(body)
  } catch {
    // TextDecoder's only failure under `fatal` is malformed input.
    return NOT_UTF8
  }

  try {
    return Object.freeze({ kind: 'json', value: JSON.parse(text) as unknown })
  } catch {
    // JSON.parse's only failure is a syntax error, and its message would quote
    // the body back, which belongs to the endpoint rather than to this result.
    return NOT_JSON
  }
}
