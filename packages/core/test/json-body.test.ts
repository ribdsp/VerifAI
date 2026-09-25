import { describe, expect, it } from 'vitest'
import { readJsonBody } from '../src/transport/json-body.js'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('readJsonBody', () => {
  it('parses a JSON body', () => {
    expect(readJsonBody(bytes('{"type":"error","error":{"message":"x"}}'))).toEqual({
      kind: 'json',
      value: { type: 'error', error: { message: 'x' } },
    })
    expect(readJsonBody(bytes('  [1, 2]\n'))).toEqual({ kind: 'json', value: [1, 2] })
    expect(readJsonBody(bytes('null'))).toEqual({ kind: 'json', value: null })
  })

  it('tells an empty body from one that is only whitespace', () => {
    expect(readJsonBody(new Uint8Array(0))).toEqual({ kind: 'empty' })
    expect(readJsonBody(bytes('\n'))).toEqual({ kind: 'not-json' })
  })

  it('tells bytes that are not UTF-8 from text that is not JSON', () => {
    expect(readJsonBody(new Uint8Array([0x7b, 0xff, 0x7d]))).toEqual({ kind: 'not-utf8' })
    expect(readJsonBody(new Uint8Array([0xed, 0xa0, 0x80]))).toEqual({ kind: 'not-utf8' })
    expect(readJsonBody(bytes('<html>Bad Gateway</html>'))).toEqual({ kind: 'not-json' })
    expect(readJsonBody(bytes('{"a":1}{"b":2}'))).toEqual({ kind: 'not-json' })
    expect(readJsonBody(bytes('data: {"a":1}\n\n'))).toEqual({ kind: 'not-json' })
  })

  it('drops a leading byte order mark, as RFC 8259 allows', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('{"a":1}')])
    expect(readJsonBody(withBom)).toEqual({ kind: 'json', value: { a: 1 } })
  })

  it('keeps a __proto__ key as data rather than a prototype', () => {
    const result = readJsonBody(bytes('{"__proto__":{"polluted":true}}'))
    expect(result.kind).toBe('json')
    const value = result.kind === 'json' ? (result.value as Record<string, unknown>) : {}
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('freezes the wrapper it returns', () => {
    expect(Object.isFrozen(readJsonBody(bytes('{}')))).toBe(true)
    expect(Object.isFrozen(readJsonBody(new Uint8Array(0)))).toBe(true)
  })
})
