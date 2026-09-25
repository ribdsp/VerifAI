import { describe, expect, it } from 'vitest'
import {
  createSseDecoder,
  type SseComment,
  type SseEvent,
  type SseItem,
  type SseSummary,
} from '../src/transport/sse.js'

const encoder = new TextEncoder()

type Chunk = string | readonly number[]

function bytesOf(chunk: Chunk): Uint8Array {
  return typeof chunk === 'string' ? encoder.encode(chunk) : Uint8Array.from(chunk)
}

/** Feeds every chunk, the n-th arriving at `n * 10` ms, and finishes the stream. */
function decode(chunks: readonly Chunk[]): {
  readonly items: readonly SseItem[]
  readonly summary: SseSummary
} {
  const decoder = createSseDecoder()
  const items = chunks.flatMap((chunk, at) => decoder.push(bytesOf(chunk), at * 10))
  return { items, summary: decoder.finish() }
}

function eventsOf(items: readonly SseItem[]): SseEvent[] {
  return items.filter((item): item is SseEvent => item.kind === 'event')
}

function commentsOf(items: readonly SseItem[]): SseComment[] {
  return items.filter((item): item is SseComment => item.kind === 'comment')
}

/** Every byte of the text as its own chunk - the harshest split a socket can deliver. */
function byteByByte(text: string): number[][] {
  return [...encoder.encode(text)].map((byte) => [byte])
}

describe('createSseDecoder', () => {
  describe('framing', () => {
    it('reads Anthropic-style named events', () => {
      const { items, summary } = decode([
        'event: message_start\n',
        'data: {"type":"message_start","message":{"id":"msg_x"}}\n\n',
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ])

      expect(eventsOf(items).map((event) => [event.type, JSON.parse(event.data).type])).toEqual([
        ['message_start', 'message_start'],
        ['content_block_delta', 'content_block_delta'],
        ['message_stop', 'message_stop'],
      ])
      expect(summary).toEqual({
        lineEndings: { lf: 9, crlf: 0, cr: 0 },
        unterminated: false,
        invalidUtf8: false,
        hadBom: false,
      })
    })

    it('reads OpenAI-style unnamed events, including the [DONE] sentinel', () => {
      const { items } = decode(['data: {"id":"chatcmpl-x","choices":[]}\n\n', 'data: [DONE]\n\n'])
      const events = eventsOf(items)

      expect(events.map((event) => event.type)).toEqual(['message', 'message'])
      expect(events.map((event) => event.data)).toEqual([
        '{"id":"chatcmpl-x","choices":[]}',
        '[DONE]',
      ])
    })

    it('joins multi-line data with LF and strips only the final one', () => {
      const { items } = decode(['data: first\ndata: second\ndata:\n\n'])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['first\nsecond\n'])
    })

    it('returns every item a single chunk completes, in wire order', () => {
      const { items } = decode([': keepalive\ndata: a\n\n: again\n'])

      expect(items.map((item) => item.kind)).toEqual(['comment', 'event', 'comment'])
    })
  })

  describe('line endings', () => {
    it('accepts CRLF and counts it once', () => {
      const { items, summary } = decode(['data: a\r\n\r\n'])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['a'])
      expect(summary.lineEndings).toEqual({ lf: 0, crlf: 2, cr: 0 })
    })

    it('accepts a lone CR as a line ending', () => {
      const { items, summary } = decode(['data: a\rdata: b\r\r'])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['a\nb'])
      expect(summary.lineEndings).toEqual({ lf: 0, crlf: 0, cr: 3 })
    })

    it('treats a CRLF split across chunks as one ending, not an extra blank line', () => {
      // Were the LF read as a line of its own, this would dispatch `x` and `y`
      // as two events instead of one.
      const { items, summary } = decode(['data: x\r', '\ndata: y\r\n\r\n'])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['x\ny'])
      expect(summary.lineEndings).toEqual({ lf: 0, crlf: 3, cr: 0 })
    })

    it('holds a chunk-final CR open across an empty chunk', () => {
      // An empty chunk says nothing about whether an LF follows the CR. Reading
      // it as "no LF" would turn the LF that does arrive into a blank line and
      // dispatch `x` on its own.
      const { items, summary } = decode(['data: x\r', [], '\ndata: y\n\n'])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['x\ny'])
      expect(summary.lineEndings).toEqual({ lf: 2, crlf: 1, cr: 0 })
    })

    it('classifies a chunk-final CR by the first character after it, not the first byte', () => {
      // The chunk after the CR is half a multi-byte character, so no text
      // arrives with it; the CR is only known to be lone once the character
      // completes.
      const { items, summary } = decode(['data: x\r', [0xe6], [0x97, 0xa5], '\n\n'])

      expect(eventsOf(items)[0]?.fields).toEqual([
        ['data', 'x'],
        ['日', ''],
      ])
      expect(summary.lineEndings).toEqual({ lf: 2, crlf: 0, cr: 1 })
    })

    it('counts every terminator kind separately in a mixed stream', () => {
      const { summary } = decode(['data: a\n\r\ndata: b\r\r'])

      expect(summary.lineEndings).toEqual({ lf: 1, crlf: 1, cr: 2 })
    })

    it('counts a CR left pending at end of stream as a lone CR', () => {
      const decoder = createSseDecoder()

      // The CR completes the blank line, so the event is ready without waiting
      // to learn whether an LF follows.
      expect(eventsOf(decoder.push(bytesOf('data: x\n\r'), 4)).map((event) => event.data)).toEqual([
        'x',
      ])
      expect(decoder.finish()).toMatchObject({
        lineEndings: { lf: 1, crlf: 0, cr: 1 },
        unterminated: false,
      })
    })
  })

  describe('UTF-8', () => {
    it('decodes a multi-byte character split byte by byte', () => {
      const { items, summary } = decode(byteByByte('data: 日本 😀\n\n'))

      expect(eventsOf(items).map((event) => event.data)).toEqual(['日本 😀'])
      expect(summary.invalidUtf8).toBe(false)
    })

    it('flags invalid UTF-8 without throwing, and decodes it as U+FFFD', () => {
      const { items, summary } = decode([[...encoder.encode('data: '), 0xff, 0x0a, 0x0a]])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['\uFFFD'])
      expect(summary.invalidUtf8).toBe(true)
    })

    it('does not mistake a genuine U+FFFD for invalid input', () => {
      const { summary } = decode(['data: \uFFFD\n\n'])

      expect(summary.invalidUtf8).toBe(false)
    })

    it('flags a multi-byte character truncated by the end of the stream', () => {
      const { items, summary } = decode(['data: x\n\n', [0xe6, 0x97]])

      expect(eventsOf(items)).toHaveLength(1)
      expect(summary).toMatchObject({ invalidUtf8: true, unterminated: true })
    })

    it('strips one leading BOM and records that it was there', () => {
      const { items, summary } = decode([[0xef, 0xbb, 0xbf, ...encoder.encode('data: x\n\n')]])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['x'])
      expect(summary.hadBom).toBe(true)
    })

    it('strips a leading BOM that arrives split across chunks', () => {
      const { items, summary } = decode([[0xef], [0xbb], [0xbf], 'data: x\n\n'])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['x'])
      expect(summary.hadBom).toBe(true)
    })

    it('strips only the first BOM, and only at the start of the stream', () => {
      const { items, summary } = decode([
        '\uFEFF\uFEFFdata: hidden\ndata: seen\n\n',
        '\uFEFFdata: also hidden\ndata: z\n\n',
      ])
      const events = eventsOf(items)

      expect(events.map((event) => event.data)).toEqual(['seen', 'z'])
      expect(events[0]?.fields).toEqual([
        ['\uFEFFdata', 'hidden'],
        ['data', 'seen'],
      ])
      expect(summary.hadBom).toBe(true)
    })

    it('reports no BOM when the stream has none', () => {
      expect(decode(['data: x\n\n']).summary.hadBom).toBe(false)
    })
  })

  describe('fields', () => {
    it('removes exactly one space after the colon, and none when there is none', () => {
      const { items } = decode(['data:x\n\n', 'data:  x\n\n', 'data: x \n\n'])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['x', ' x', 'x '])
    })

    it('reads a line without a colon as a field name with an empty value', () => {
      // `data` alone appends an empty line, so the data buffer is "\n" - not
      // empty - and the event dispatches with empty data.
      const { items } = decode(['data\n\n'])
      const events = eventsOf(items)

      expect(events.map((event) => event.data)).toEqual([''])
      expect(events[0]?.fields).toEqual([['data', '']])
    })

    it('splits on the first colon only', () => {
      const { items } = decode(['data: a: b\n\n'])

      expect(eventsOf(items)[0]?.fields).toEqual([['data', 'a: b']])
    })

    it('keeps every field line of the event in wire order, unknown ones included', () => {
      const { items } = decode([
        'foo: bar\nevent: delta\nid: 9\nretry: 250\ndata: x\nFoo: other\n\n',
      ])

      expect(eventsOf(items)[0]?.fields).toEqual([
        ['foo', 'bar'],
        ['event', 'delta'],
        ['id', '9'],
        ['retry', '250'],
        ['data', 'x'],
        ['Foo', 'other'],
      ])
    })

    it('matches field names case-sensitively', () => {
      const { items } = decode(['Data: x\nEVENT: y\ndata: z\n\n'])

      expect(eventsOf(items).map((event) => [event.type, event.data])).toEqual([['message', 'z']])
    })

    it('starts each event with a fresh field list and type', () => {
      const { items } = decode(['event: first\ndata: a\n\ndata: b\n\n'])

      expect(eventsOf(items).map((event) => [event.type, event.fields])).toEqual([
        [
          'first',
          [
            ['event', 'first'],
            ['data', 'a'],
          ],
        ],
        ['message', [['data', 'b']]],
      ])
    })
  })

  describe('id and retry', () => {
    it('carries the last event id across events until it is replaced', () => {
      const { items } = decode(['id: 7\ndata: a\n\n', 'data: b\n\n', 'id\ndata: c\n\n'])

      expect(eventsOf(items).map((event) => event.lastEventId)).toEqual(['7', '7', ''])
    })

    it('ignores an id containing U+0000', () => {
      const { items } = decode(['id: 1\ndata: a\n\n', 'id: 2\u0000x\ndata: b\n\n'])

      expect(eventsOf(items).map((event) => event.lastEventId)).toEqual(['1', '1'])
    })

    it('keeps an id set by a block that dispatched nothing', () => {
      const { items } = decode(['id: 3\n\n', 'data: a\n\n'])

      expect(eventsOf(items).map((event) => event.lastEventId)).toEqual(['3'])
    })

    it('surfaces an all-digit retry on the event it arrived with, and only that one', () => {
      const { items } = decode(['retry: 3000\ndata: a\n\n', 'data: b\n\n'])
      const [first, second] = eventsOf(items)

      expect(first?.retryMs).toBe(3000)
      expect(second !== undefined && 'retryMs' in second).toBe(false)
    })

    it('ignores a retry value that is not all ASCII digits', () => {
      const { items } = decode([
        'retry: 3s\ndata: a\n\n',
        'retry:\ndata: b\n\n',
        'retry: -1\ndata: c\n\n',
      ])

      expect(eventsOf(items).map((event) => 'retryMs' in event)).toEqual([false, false, false])
    })
  })

  describe('dispatch', () => {
    it('dispatches nothing for a block with no data', () => {
      const { items, summary } = decode(['event: ping\n\n', '\n\n', 'data: after\n\n'])
      const events = eventsOf(items)

      // The `event: ping` type must not leak into the next event either.
      expect(events.map((event) => [event.type, event.data])).toEqual([['message', 'after']])
      expect(summary.unterminated).toBe(false)
    })

    it('stamps an event with the arrival time of the chunk that completed it', () => {
      const decoder = createSseDecoder()

      expect(decoder.push(bytesOf('data: hel'), 5)).toEqual([])
      expect(decoder.push(bytesOf('lo\n'), 9)).toEqual([])
      const [event] = eventsOf(decoder.push(bytesOf('\n'), 20))

      expect(event).toMatchObject({ data: 'hello', atMs: 20 })
    })

    it('discards an event the stream ended before completing, and says so', () => {
      const { items, summary } = decode(['data: done\n\n', 'data: partial'])

      expect(eventsOf(items).map((event) => event.data)).toEqual(['done'])
      expect(summary.unterminated).toBe(true)
    })

    it('reports an event whose last field line ended but whose blank line never came', () => {
      const { items, summary } = decode(['data: done\n\n', 'data: y\n'])

      expect(eventsOf(items)).toHaveLength(1)
      expect(summary.unterminated).toBe(true)
    })

    it('reports a partial comment line as unterminated', () => {
      expect(decode(['data: a\n\n: trailing']).summary.unterminated).toBe(true)
    })

    it('reports a clean empty stream', () => {
      expect(decode([]).summary).toEqual({
        lineEndings: { lf: 0, crlf: 0, cr: 0 },
        unterminated: false,
        invalidUtf8: false,
        hadBom: false,
      })
    })
  })

  describe('comments', () => {
    it('emits a comment as soon as its line ends, with one leading space removed', () => {
      const decoder = createSseDecoder()
      const [comment] = commentsOf(decoder.push(bytesOf(': OPENROUTER PROCESSING\n'), 12))

      expect(comment).toEqual({ kind: 'comment', text: 'OPENROUTER PROCESSING', atMs: 12 })
    })

    it('keeps the text exactly beyond the first space', () => {
      const { items } = decode([':\n', ':no space\n', ':  two\n'])

      expect(commentsOf(items).map((comment) => comment.text)).toEqual(['', 'no space', ' two'])
    })

    it('does not treat a comment as part of the event around it', () => {
      const { items } = decode(['data: a\n: note\ndata: b\n\n'])
      const [event] = eventsOf(items)

      expect(event?.data).toBe('a\nb')
      expect(event?.fields).toEqual([
        ['data', 'a'],
        ['data', 'b'],
      ])
    })
  })

  describe('lifecycle and immutability', () => {
    it('refuses input after the stream has finished', () => {
      const decoder = createSseDecoder()
      decoder.finish()

      expect(() => decoder.push(bytesOf('data: x\n\n'), 1)).toThrow(/finished/)
      expect(() => decoder.finish()).toThrow(/finished/)
    })

    it('freezes everything it returns', () => {
      const decoder = createSseDecoder()
      const items = decoder.push(bytesOf(': c\ndata: x\n\n'), 1)
      const [event] = eventsOf(items)
      const summary = decoder.finish()

      expect(Object.isFrozen(items)).toBe(true)
      expect(items.every((item) => Object.isFrozen(item))).toBe(true)
      expect(event !== undefined && Object.isFrozen(event.fields)).toBe(true)
      expect(event?.fields.every((field) => Object.isFrozen(field))).toBe(true)
      expect(Object.isFrozen(summary)).toBe(true)
      expect(Object.isFrozen(summary.lineEndings)).toBe(true)
    })

    it('does not depend on the caller keeping the chunk intact', () => {
      const decoder = createSseDecoder()
      const chunk = bytesOf('data: abc')
      decoder.push(chunk, 1)
      chunk.fill(0x21)
      const [event] = eventsOf(decoder.push(bytesOf('\n\n'), 2))

      expect(event?.data).toBe('abc')
    })
  })
})
