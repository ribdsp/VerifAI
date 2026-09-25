import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import {
  deviationsFrom,
  MAX_DEVIATIONS,
  MAX_RECEIVED_LENGTH,
  openVariant,
  orNull,
  TOKEN_COUNT,
} from '../src/adapters/conformance.js'
import {
  isJsonObject,
  member,
  objectsIn,
  readArray,
  readCount,
  readNullableString,
  readObject,
  readString,
} from '../src/adapters/json.js'

describe('lenient JSON readers', () => {
  const body = JSON.parse(
    '{"s":"x","n":null,"c":3,"f":1.5,"neg":-1,"big":1e300,"a":[1,{"k":1},null],"o":{"k":1},"__proto__":{"evil":1}}',
  ) as Record<string, unknown>

  it('recognises objects, and not arrays or null', () => {
    expect(isJsonObject({})).toBe(true)
    expect(isJsonObject([])).toBe(false)
    expect(isJsonObject(null)).toBe(false)
    expect(isJsonObject('x')).toBe(false)
  })

  it('reads each type and reports undefined for anything else', () => {
    expect(readString(body, 's')).toBe('x')
    expect(readString(body, 'c')).toBeUndefined()
    expect(readNullableString(body, 's')).toBe('x')
    expect(readNullableString(body, 'n')).toBeNull()
    expect(readNullableString(body, 'missing')).toBeUndefined()
    expect(readNullableString(body, 'c')).toBeUndefined()
    expect(readArray(body, 'a')).toEqual([1, { k: 1 }, null])
    expect(readArray(body, 'o')).toBeUndefined()
    expect(readObject(body, 'o')).toEqual({ k: 1 })
    expect(readObject(body, 'a')).toBeUndefined()
    expect(objectsIn(readArray(body, 'a'))).toEqual([{ k: 1 }])
    expect(objectsIn(undefined)).toEqual([])
  })

  it('reads only whole, non-negative, exactly representable counts', () => {
    expect(readCount(body, 'c')).toBe(3)
    expect(readCount(body, 'f')).toBeUndefined()
    expect(readCount(body, 'neg')).toBeUndefined()
    expect(readCount(body, 'big')).toBeUndefined()
    expect(readCount(body, 's')).toBeUndefined()
  })

  it('never resolves a key the body did not send to an inherited value', () => {
    expect(member(body, 'constructor')).toBeUndefined()
    expect(member(body, 'toString')).toBeUndefined()
    expect(readObject({}, 'constructor')).toBeUndefined()
    expect(readObject(body, '__proto__')).toEqual({ evil: 1 })
  })
})

describe('deviationsFrom', () => {
  const schema = v.object({
    type: v.literal('error'),
    error: v.object({
      message: v.string(),
      code: orNull(v.string()),
    }),
    count: TOKEN_COUNT,
    items: v.array(v.object({ a: v.string() })),
    detail: v.optional(v.nullable(v.object({ reason: v.string() }))),
  })

  it('reports nothing for a conforming body, including keys the schema does not name', () => {
    const body = {
      type: 'error',
      error: { message: 'm', code: null, extra: 1 },
      count: 0,
      items: [],
    }
    expect(deviationsFrom(schema, body)).toEqual([])
    expect(deviationsFrom(schema, { ...body, detail: null })).toEqual([])
  })

  it('reports each deviation with its path, what was expected and what was there', () => {
    const body = {
      type: 'err',
      error: { code: 5 },
      count: -1,
      items: [{ a: 'ok' }, { a: 1 }],
      detail: { reason: 2 },
    }
    expect(deviationsFrom(schema, body)).toEqual([
      { path: 'type', expected: '"error"', received: '"err"' },
      { path: 'error.message', expected: 'present', received: 'absent' },
      { path: 'error.code', expected: '(string | null)', received: '5' },
      { path: 'count', expected: '>=0', received: '-1' },
      { path: 'items.1.a', expected: 'string', received: '1' },
      { path: 'detail.reason', expected: 'string', received: '2' },
    ])
  })

  it('reports a body that is not an object at the root', () => {
    expect(deviationsFrom(schema, null)).toEqual([
      { path: '', expected: 'Object', received: 'null' },
    ])
    expect(deviationsFrom(schema, 'text')).toEqual([
      { path: '', expected: 'Object', received: '"text"' },
    ])
    // valibot reads an array as an object with none of the required keys.
    expect(deviationsFrom(schema, []).map(({ path }) => path)).toEqual([
      'type',
      'error',
      'count',
      'items',
    ])
  })

  it('names a failed check that has no expected value by its type', () => {
    expect(deviationsFrom(TOKEN_COUNT, 1.5)).toEqual([
      { path: '', expected: 'safe_integer', received: '1.5' },
    ])
  })

  it('cuts a long received value', () => {
    const [deviation] = deviationsFrom(schema, { type: 'x'.repeat(500) })
    expect(deviation?.received).toHaveLength(MAX_RECEIVED_LENGTH)
    expect(deviation?.received.endsWith('…')).toBe(true)
  })

  it('stops at the cap, however many items are wrong', () => {
    const body = { type: 'error', error: { message: 'm', code: null }, count: 0 }
    const items = Array.from({ length: 1000 }, () => ({ a: 1 }))
    expect(deviationsFrom(schema, { ...body, items })).toHaveLength(MAX_DEVIATIONS)
  })

  it('freezes what it returns', () => {
    const deviations = deviationsFrom(schema, {})
    expect(Object.isFrozen(deviations)).toBe(true)
    expect(deviations.every((deviation) => Object.isFrozen(deviation))).toBe(true)
    expect(Object.isFrozen(deviationsFrom(TOKEN_COUNT, 1))).toBe(true)
  })
})

describe('openVariant', () => {
  const blocks = v.array(
    openVariant('type', {
      text: { text: v.string() },
      thinking: { thinking: v.string(), signature: v.string() },
    }),
  )

  it('checks a member of a known kind against that kind', () => {
    expect(deviationsFrom(blocks, [{ type: 'text', text: 'a' }])).toEqual([])
    expect(deviationsFrom(blocks, [{ type: 'text', text: 5 }])).toEqual([
      { path: '0.text', expected: 'string', received: '5' },
    ])
    expect(deviationsFrom(blocks, [{ type: 'thinking', thinking: '' }])).toEqual([
      { path: '0.signature', expected: 'present', received: 'absent' },
    ])
  })

  it('lets a member of a kind it does not name pass', () => {
    expect(deviationsFrom(blocks, [{ type: 'server_tool_use', id: 1 }])).toEqual([])
  })

  it('reports a member with no usable kind', () => {
    const expected = '("text" | "thinking" | string)'
    expect(deviationsFrom(blocks, [{ text: 'a' }])).toEqual([
      { path: '0.type', expected, received: 'absent' },
    ])
    expect(deviationsFrom(blocks, [{ type: 7 }])).toEqual([
      { path: '0.type', expected, received: '7' },
    ])
    expect(deviationsFrom(blocks, ['text'])).toEqual([
      { path: '0', expected: 'Object', received: '"text"' },
    ])
  })
})
