/**
 * Server-sent events, decoded incrementally from the bytes the transport read.
 *
 * Both vendors stream over SSE, and a streamed response is evidence twice over:
 * what the events say, and how they are framed. A genuine backend and a proxy
 * re-emitting its output can agree on every event and still differ on line
 * endings, keepalive comments, a byte-order mark or a stray invalid byte - so
 * the decoder reports the framing it saw instead of normalising it away.
 *
 * Parsing follows the WHATWG HTML "Interpreting an event stream" rules, which
 * are what a browser `EventSource` does. Deviations from what a client needs
 * are additive only: comments and every field line are surfaced, `retry` is
 * attached to the event it arrived with, and the summary counts terminators.
 *
 * The decoder is push-based because the transport buffers a body as chunks
 * stamped with their arrival time; an event is stamped with the arrival of the
 * chunk that completed it, which is what time-to-first-token is measured from.
 */

export interface SseEvent {
  readonly kind: 'event'
  /** The `event` field, or `message` when the event named none. */
  readonly type: string
  /** Every `data` line, joined with LF. */
  readonly data: string
  /** The last event ID in force when this event dispatched; it persists across events. */
  readonly lastEventId: string
  /** An all-digit `retry` field that arrived with this event. */
  readonly retryMs?: number
  /** Every field line of the event in wire order, unknown names included. */
  readonly fields: readonly (readonly [name: string, value: string])[]
  /** Arrival time of the chunk that completed the event. */
  readonly atMs: number
}

export interface SseComment {
  readonly kind: 'comment'
  readonly text: string
  readonly atMs: number
}

export type SseItem = SseEvent | SseComment

export interface SseSummary {
  readonly lineEndings: { readonly lf: number; readonly crlf: number; readonly cr: number }
  /** The stream ended inside a line or an event, which the spec discards. */
  readonly unterminated: boolean
  /** Some bytes were not valid UTF-8 and were decoded as U+FFFD. */
  readonly invalidUtf8: boolean
  /** The stream opened with a byte-order mark, which was stripped. */
  readonly hadBom: boolean
}

export interface SseDecoder {
  /**
   * Feeds the next chunk of body bytes; `atMs` is that chunk's arrival time.
   * Returns the items this chunk completed, in wire order.
   */
  push(bytes: Uint8Array, atMs: number): readonly SseItem[]
  /**
   * Signals end of stream. Nothing can complete here: a line is processed as
   * soon as its terminator arrives, so what is left is discarded per the spec
   * and reported as `unterminated`.
   */
  finish(): SseSummary
}

const LF = 0x0a
const CR = 0x0d
const COLON = ':'
const BOM = String.fromCharCode(0xfeff)
const NUL = String.fromCharCode(0)
const DIGITS = /^[0-9]+$/

type Field = readonly [name: string, value: string]

/** Removes the one space the spec allows after a colon, and no more. */
function afterColon(text: string): string {
  return text.startsWith(' ') ? text.slice(1) : text
}

function parseField(line: string): Field {
  const colon = line.indexOf(COLON)
  if (colon === -1) {
    return Object.freeze([line, ''] as const)
  }
  return Object.freeze([line.slice(0, colon), afterColon(line.slice(colon + 1))] as const)
}

export function createSseDecoder(): SseDecoder {
  // `ignoreBOM: true` keeps the mark in the output, so its presence can be
  // recorded before it is stripped; the default would drop it silently.
  const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
  // A second, fatal decoder over the same bytes is the only reliable way to
  // tell a malformed byte from a genuine U+FFFD the server sent.
  let validator: TextDecoder | undefined = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  })

  const lineEndings = { lf: 0, crlf: 0, cr: 0 }
  let invalidUtf8 = false
  let hadBom = false
  let started = false
  let finished = false

  let line = ''
  // A CR that ends the decoded text so far: its line is already processed, but
  // whether it is a lone CR or half of a CRLF waits on the next character.
  let pendingCr = false

  let data = ''
  let type = ''
  let lastEventId = ''
  let retryMs: number | undefined
  let fields: Field[] = []

  function validate(bytes: Uint8Array | undefined): void {
    if (validator === undefined) {
      return
    }
    try {
      if (bytes === undefined) {
        validator.decode()
      } else {
        validator.decode(bytes, { stream: true })
      }
    } catch {
      // Not swallowed: the failure is the finding, and it is reported in the
      // summary. Once malformed, the stream stays malformed, so stop checking.
      invalidUtf8 = true
      validator = undefined
    }
  }

  function dispatch(atMs: number, out: SseItem[]): void {
    if (data !== '') {
      const event: SseEvent = {
        kind: 'event',
        type: type === '' ? 'message' : type,
        // Every `data` line appends an LF, so a non-empty buffer always ends in one.
        data: data.slice(0, -1),
        lastEventId,
        ...(retryMs === undefined ? {} : { retryMs }),
        fields: Object.freeze(fields),
        atMs,
      }
      out.push(Object.freeze(event))
    }
    // The last event ID deliberately survives: the spec keeps it across events.
    data = ''
    type = ''
    retryMs = undefined
    fields = []
  }

  function processField(field: Field): void {
    fields.push(field)
    const [name, value] = field

    if (name === 'data') {
      data += `${value}\n`
    } else if (name === 'event') {
      type = value
    } else if (name === 'id') {
      if (!value.includes(NUL)) {
        lastEventId = value
      }
    } else if (name === 'retry' && DIGITS.test(value)) {
      retryMs = Number(value)
    }
  }

  function processLine(atMs: number, out: SseItem[]): void {
    const complete = line
    line = ''

    if (complete === '') {
      dispatch(atMs, out)
    } else if (complete.startsWith(COLON)) {
      out.push(Object.freeze({ kind: 'comment', text: afterColon(complete.slice(1)), atMs }))
    } else {
      processField(parseField(complete))
    }
  }

  /** Settles a CR the previous chunk left open; returns where scanning resumes. */
  function settlePendingCr(decoded: string): number {
    // An empty decode - an empty chunk, or half a multi-byte character - says
    // nothing about what follows the CR, so the question stays open.
    if (!pendingCr || decoded.length === 0) {
      return 0
    }
    pendingCr = false
    if (decoded.charCodeAt(0) === LF) {
      lineEndings.crlf += 1
      return 1
    }
    lineEndings.cr += 1
    return 0
  }

  /** Counts the terminator starting at `at` and returns the index just past it. */
  function passTerminator(decoded: string, at: number): number {
    if (decoded.charCodeAt(at) === LF) {
      lineEndings.lf += 1
      return at + 1
    }
    if (at + 1 === decoded.length) {
      pendingCr = true
      return at + 1
    }
    if (decoded.charCodeAt(at + 1) === LF) {
      lineEndings.crlf += 1
      return at + 2
    }
    lineEndings.cr += 1
    return at + 1
  }

  function scan(decoded: string, atMs: number, out: SseItem[]): void {
    let start = settlePendingCr(decoded)
    let at = start

    while (at < decoded.length) {
      const code = decoded.charCodeAt(at)

      if (code === LF || code === CR) {
        // Either way the line has ended; only how to count the ending can wait.
        line += decoded.slice(start, at)
        processLine(atMs, out)
        at = passTerminator(decoded, at)
        start = at
      } else {
        at += 1
      }
    }
    line += decoded.slice(start)
  }

  function stripBom(decoded: string): string {
    if (started || decoded === '') {
      return decoded
    }
    started = true
    if (decoded.startsWith(BOM)) {
      hadBom = true
      return decoded.slice(BOM.length)
    }
    return decoded
  }

  function assertOpen(): void {
    if (finished) {
      throw new Error('SSE decoder has already finished; it cannot take more input')
    }
  }

  return Object.freeze({
    push(bytes: Uint8Array, atMs: number): readonly SseItem[] {
      assertOpen()
      validate(bytes)

      const out: SseItem[] = []
      scan(stripBom(text.decode(bytes, { stream: true })), atMs, out)
      return Object.freeze(out)
    },

    finish(): SseSummary {
      assertOpen()
      finished = true
      validate(undefined)

      // A trailing partial character decodes to U+FFFD here; it can only land
      // in the unterminated line, since it cannot be a terminator.
      line += stripBom(text.decode())
      if (pendingCr) {
        pendingCr = false
        lineEndings.cr += 1
      }

      return Object.freeze({
        lineEndings: Object.freeze({ ...lineEndings }),
        unterminated: line !== '' || fields.length > 0,
        invalidUtf8,
        hadBom,
      })
    },
  })
}
