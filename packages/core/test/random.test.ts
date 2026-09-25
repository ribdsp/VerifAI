import { describe, expect, it } from 'vitest'
import { randomId } from '../src/service/random.js'

describe('randomId', () => {
  it('draws lowercase letters and digits, as many as asked', () => {
    for (const length of [1, 8, 24, 256]) {
      expect(randomId(length)).toMatch(new RegExp(`^[a-z0-9]{${length}}$`))
    }
  })

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId(24)))
    expect(ids.size).toBe(200)
  })

  it('uses every character of the alphabet', () => {
    const seen = new Set(randomId(256).concat(randomId(256), randomId(256)))
    expect(seen.size).toBe(36)
  })

  it.each([0, -1, 257, 1.5, Number.NaN])('refuses a length of %s', (length) => {
    expect(() => randomId(length)).toThrow(TypeError)
  })
})
