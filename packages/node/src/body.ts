/**
 * Reading a response body: content decoding, the size limit, and when each
 * piece arrived.
 */

import type { IncomingMessage } from 'node:http'
import type { Transform } from 'node:stream'
import zlib from 'node:zlib'
import { type BodyChunk, type HeaderPair, headerValues } from '@verifai/core'

type Decoder = () => Transform

const DECODERS: ReadonlyMap<string, Decoder> = new Map([
  ['gzip', () => zlib.createGunzip()],
  ['x-gzip', () => zlib.createGunzip()],
  ['deflate', () => zlib.createInflate()],
  ['br', () => zlib.createBrotliDecompress()],
])

/** `identity` for a body sent as-is, `unsupported` for anything this transport cannot undo. */
export type BodyCoding = 'identity' | 'unsupported' | Decoder

/**
 * One coding at most. A stack such as `gzip, br` is legal HTTP that no AI
 * endpoint sends, and undoing it would add a code path to prove for nothing.
 */
export function bodyCoding(headers: readonly HeaderPair[]): BodyCoding {
  const codings = headerValues(headers, 'content-encoding')
    .flatMap((value) => value.split(','))
    .map((coding) => coding.trim().toLowerCase())
    .filter((coding) => coding !== '' && coding !== 'identity')

  if (codings.length === 0) {
    return 'identity'
  }
  const [only] = codings
  return (codings.length === 1 && only !== undefined && DECODERS.get(only)) || 'unsupported'
}

export type BodyOutcome =
  | {
      readonly ok: true
      readonly body: Uint8Array
      readonly chunks: readonly BodyChunk[]
      readonly completedMs: number
    }
  | { readonly ok: false; readonly kind: 'response-too-large' | 'unreadable-response' }

const TOO_LARGE: BodyOutcome = Object.freeze({ ok: false, kind: 'response-too-large' })
const UNREADABLE: BodyOutcome = Object.freeze({ ok: false, kind: 'unreadable-response' })

interface Collector {
  /** @returns false once the body would pass the limit; nothing past it is kept. */
  readonly add: (part: Uint8Array) => boolean
  readonly finish: () => BodyOutcome
}

function createCollector(maxBytes: number, clock: () => number): Collector {
  const parts: Uint8Array[] = []
  const chunks: BodyChunk[] = []
  let total = 0

  return {
    add: (part) => {
      if (part.length === 0) {
        return true
      }
      const end = total + part.length
      if (end > maxBytes) {
        return false
      }
      parts.push(part)
      chunks.push(Object.freeze({ atMs: clock(), start: total, end }))
      total = end
      return true
    },
    finish: () => {
      // A plain Uint8Array rather than a Buffer: portable code expects `slice`
      // to copy, and a Buffer's `slice` is a view.
      const body = new Uint8Array(total)
      let offset = 0
      for (const part of parts) {
        body.set(part, offset)
        offset += part.length
      }
      return Object.freeze({ ok: true, body, chunks: Object.freeze(chunks), completedMs: clock() })
    },
  }
}

/**
 * Resolves once, never rejects, and destroys `response` on every path out.
 * That includes success, which is only safe because every request is sent
 * `Connection: close` on a socket of its own: reusing connections would mean
 * draining the response here instead.
 *
 * The decoder is created when the first byte arrives rather than up front:
 * zlib treats an empty input as a truncated stream, and a `204` or an empty
 * `200` may still say `Content-Encoding: gzip`.
 */
export function readBody(
  response: IncomingMessage,
  coding: Exclude<BodyCoding, 'unsupported'>,
  maxBytes: number,
  clock: () => number,
): Promise<BodyOutcome> {
  return new Promise((resolve) => {
    const collector = createCollector(maxBytes, clock)
    let decoder: Transform | undefined
    let settled = false

    const settle = (outcome: BodyOutcome) => {
      if (!settled) {
        settled = true
        decoder?.destroy()
        response.destroy()
        resolve(outcome)
      }
    }
    const accept = (part: Uint8Array) => {
      if (!collector.add(part)) {
        settle(TOO_LARGE)
      }
    }
    const startDecoder = (create: Decoder): Transform => {
      const started = create()
      started.on('data', accept)
      started.on('end', () => settle(collector.finish()))
      started.on('error', () => settle(UNREADABLE))
      started.on('drain', () => response.resume())
      return started
    }

    response.on('data', (raw: Buffer) => {
      if (coding === 'identity') {
        accept(raw)
        return
      }
      decoder ??= startDecoder(coding)
      if (!decoder.write(raw)) {
        response.pause()
      }
    })
    response.on('end', () => {
      if (decoder === undefined) {
        settle(collector.finish())
      } else {
        decoder.end()
      }
    })
    response.on('error', () => settle(UNREADABLE))
    // A connection that closes mid-body ends the stream without an `end`.
    response.on('close', () => {
      if (!response.complete) {
        settle(UNREADABLE)
      }
    })
  })
}
