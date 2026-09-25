import { describe, expect, it } from 'vitest'
import { joinTexts } from '../src/adapters/json.js'
import { credentialHeaders, JSON_CONTENT_TYPE } from '../src/adapters/request-headers.js'

describe('credentialHeaders', () => {
  it('puts the key where the scheme says', () => {
    expect(credentialHeaders(['x-api-key', 'bearer'], 'x-api-key', 'k-1')).toEqual([
      ['X-Api-Key', 'k-1'],
    ])
    expect(credentialHeaders(['x-api-key', 'bearer'], 'bearer', 'k-1')).toEqual([
      ['Authorization', 'Bearer k-1'],
    ])
  })

  it('sends no header without a key', () => {
    expect(credentialHeaders(['bearer'], 'bearer', undefined)).toEqual([])
  })

  it('refuses a scheme the protocol does not document, key or no key', () => {
    for (const apiKey of ['secret-value-1234', undefined]) {
      const attempt = () => credentialHeaders(['bearer'], 'x-api-key', apiKey)
      expect(attempt).toThrow(TypeError)
      expect(attempt).not.toThrow(/secret-value/)
    }
  })

  it('freezes the header it returns', () => {
    const [pair] = credentialHeaders(['bearer'], 'bearer', 'k-1')
    expect(Object.isFrozen(pair)).toBe(true)
    expect(Object.isFrozen(JSON_CONTENT_TYPE)).toBe(true)
  })
})

describe('joinTexts', () => {
  it('joins in order and skips what did not read as text', () => {
    expect(joinTexts(['a', undefined, 'b'])).toBe('ab')
  })

  it('tells no text from empty text', () => {
    expect(joinTexts([])).toBeUndefined()
    expect(joinTexts([undefined])).toBeUndefined()
    expect(joinTexts([''])).toBe('')
  })
})
