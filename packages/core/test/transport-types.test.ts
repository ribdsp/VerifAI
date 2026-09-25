import { describe, expect, it } from 'vitest'
import {
  assertSendableHeaders,
  headerValue,
  headerValues,
  pairsFromRawHeaders,
} from '../src/transport/headers.js'
import { TRANSPORT_FAILURES, transportFailure } from '../src/transport/types.js'

const HEADERS = [
  ['Content-Type', 'application/json'],
  ['X-Dup', 'a'],
  ['x-dup', 'b'],
] as const

describe('header lookup', () => {
  it('matches names case-insensitively and keeps every repeated value in order', () => {
    expect(headerValues(HEADERS, 'x-DUP')).toEqual(['a', 'b'])
    expect(headerValue(HEADERS, 'content-type')).toBe('application/json')
    expect(headerValue(HEADERS, 'retry-after')).toBeUndefined()
    expect(headerValues(HEADERS, 'retry-after')).toEqual([])
  })
})

describe('pairsFromRawHeaders', () => {
  it('pairs up the flat name/value list Node reports, preserving case and duplicates', () => {
    expect(pairsFromRawHeaders(['X-Dup', 'a', 'x-dup', 'b'])).toEqual([
      ['X-Dup', 'a'],
      ['x-dup', 'b'],
    ])
  })

  it('refuses a list with a dangling name rather than inventing a value', () => {
    expect(() => pairsFromRawHeaders(['X-Only'])).toThrow(TypeError)
  })
})

describe('assertSendableHeaders', () => {
  it('accepts ordinary headers', () => {
    expect(() =>
      assertSendableHeaders([
        ['x-api-key', 'abc'],
        ['anthropic-version', '2023-06-01'],
        ['User-Agent', 'verifai/0.0.0 (+https://github.com/ribdsp/VerifAI)'],
        ['Accept', '*/*'],
      ]),
    ).not.toThrow()
  })

  it('reserves the headers the transport has to own', () => {
    for (const name of ['Host', 'content-length', 'Transfer-Encoding', 'CONNECTION']) {
      expect(() => assertSendableHeaders([[name, 'x']]), name).toThrow(/reserved/)
    }
  })

  it('refuses names that are not HTTP tokens', () => {
    for (const name of ['', 'Bad Name', 'x:y', 'x\r\ny', 'é']) {
      expect(() => assertSendableHeaders([[name, 'x']]), JSON.stringify(name)).toThrow(TypeError)
    }
  })

  it('refuses values that could split the request, without echoing the value', () => {
    // The value is usually a credential, and an error message is rendered output.
    const secret = 'secret-value-that-must-not-appear'
    for (const value of [`${secret}\r\nX-Injected: 1`, `${secret}\n`, `${secret}\u0000`]) {
      let message = ''
      try {
        assertSendableHeaders([['x-api-key', value]])
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message).toMatch(/x-api-key/)
      expect(message).not.toContain(secret)
    }
  })
})

describe('transportFailure', () => {
  const details = { sent: false, connection: 'unobserved', startedMs: 1, failedMs: 2 } as const

  it('attaches the fixed message for every kind', () => {
    for (const kind of TRANSPORT_FAILURES.values) {
      const failure = transportFailure(kind, details)
      expect(failure.ok).toBe(false)
      expect(failure.kind).toBe(kind)
      expect(failure.message.length).toBeGreaterThan(0)
      expect(Object.isFrozen(failure)).toBe(true)
    }
  })

  it('carries the refused scope only on a blocked target', () => {
    expect(
      transportFailure('blocked-target', { ...details, blockedScope: 'private' }).blockedScope,
    ).toBe('private')
    expect(transportFailure('timeout', { ...details, blockedScope: 'private' })).not.toHaveProperty(
      'blockedScope',
    )
  })
})
