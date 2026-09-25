import { describe, expect, it } from 'vitest'
import {
  API_KEY_PROBLEMS,
  MAX_API_KEY_LENGTH,
  MIN_API_KEY_LENGTH,
  normaliseApiKey,
} from '../src/credentials/api-key.js'

// Assembled at runtime so the file itself never holds a credential-shaped
// literal for the secret scan to find.
const ANTHROPIC_SHAPED = ['sk', 'ant', 'api03', 'Q7vK2mZp9xLr4TbN8cWf3HjD6sYg1EaU5oIqR0nVkM'].join(
  '-',
)
const OPENAI_SHAPED = ['sk', 'proj', 'Hq3Zt8Lw1Nc6Vb0Xm5Ks9Pd2Rf7Gj4Ya_Te-Uo'].join('-')

describe('normaliseApiKey', () => {
  it('accepts realistic key shapes unchanged', () => {
    for (const key of [ANTHROPIC_SHAPED, OPENAI_SHAPED, 'sk-1234', 'abcd']) {
      expect(normaliseApiKey(key)).toEqual({ ok: true, key })
    }
  })

  it('trims the whitespace a pasted key picks up, and only that', () => {
    expect(normaliseApiKey(`  ${OPENAI_SHAPED}\r\n`)).toEqual({ ok: true, key: OPENAI_SHAPED })
    expect(normaliseApiKey(`\t${OPENAI_SHAPED}\n\n`)).toEqual({ ok: true, key: OPENAI_SHAPED })
  })

  it('reports an empty key, including one that is only whitespace', () => {
    for (const input of ['', ' ', '\r\n', ' \t \n ']) {
      expect(normaliseApiKey(input), JSON.stringify(input)).toEqual({ ok: false, problem: 'empty' })
    }
  })

  it('measures length after trimming', () => {
    expect(MIN_API_KEY_LENGTH).toBe(4)
    expect(normaliseApiKey('abc')).toEqual({ ok: false, problem: 'too-short' })
    expect(normaliseApiKey('  abc  ')).toEqual({ ok: false, problem: 'too-short' })
    expect(normaliseApiKey(' abcd ')).toEqual({ ok: true, key: 'abcd' })
  })

  it('refuses a key longer than any header should carry', () => {
    expect(MAX_API_KEY_LENGTH).toBe(4096)
    const longest = 'k'.repeat(MAX_API_KEY_LENGTH)
    expect(normaliseApiKey(longest)).toEqual({ ok: true, key: longest })
    expect(normaliseApiKey(`${longest}k`)).toEqual({ ok: false, problem: 'too-long' })
  })

  it('refuses anything but visible ASCII, which is what keeps it out of header injection', () => {
    for (const input of [
      'abcd efgh', // inner space
      'abcd\tefgh',
      'abcd\r\nX-Injected: 1',
      'abcd\nefgh',
      'abcd\u0000efgh',
      'abcd\u007fefgh', // DEL
      'k\u00e9y-1234',
      'abcd\u200befgh', // zero-width space
      '\u00a0abcdefgh', // NBSP is not trimmed: it is not what a terminal paste adds
      '\vabcdefgh',
      'abcdefgh\f',
      '\ud800abcdefgh', // lone surrogate
    ]) {
      expect(normaliseApiKey(input), JSON.stringify(input)).toEqual({
        ok: false,
        problem: 'invalid-character',
      })
    }
  })

  it('accepts every visible ASCII character, since keys are opaque', () => {
    let visible = ''
    for (let code = 0x21; code <= 0x7e; code += 1) {
      visible += String.fromCharCode(code)
    }
    expect(normaliseApiKey(visible)).toEqual({ ok: true, key: visible })
  })

  it('never carries any part of a refused key in the result', () => {
    const refused = [
      `${ANTHROPIC_SHAPED} tail`,
      `${OPENAI_SHAPED}\r\nX: 1`,
      'abc',
      'k'.repeat(5000),
    ]
    for (const input of refused) {
      const result = normaliseApiKey(input)
      expect(result.ok).toBe(false)
      expect(Object.keys(result).sort()).toEqual(['ok', 'problem'])
      expect(JSON.stringify(result)).not.toContain(input.slice(0, 3))
    }
  })

  it('only reports declared problems, in frozen results', () => {
    for (const input of ['', 'abc', 'k'.repeat(5000), 'a b c d', ANTHROPIC_SHAPED]) {
      const result = normaliseApiKey(input)
      expect(Object.isFrozen(result)).toBe(true)
      if (!result.ok) {
        expect(API_KEY_PROBLEMS.has(result.problem)).toBe(true)
      }
    }
  })
})
