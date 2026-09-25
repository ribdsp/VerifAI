import { describe, expect, it } from 'vitest'
import { LOCAL_ENCODINGS, type LocalEncoding, loadTokenizer } from '../src/tokenizer/local.js'

describe('loadTokenizer', () => {
  it('splits "Tides" at the o200k_base merge boundary a genuine GPT-4o+ backend reports', async () => {
    const o200k = await loadTokenizer('o200k_base')
    const tokens = o200k.encode('Tides')

    expect(tokens.map((token) => o200k.decode([token]))).toEqual(['T', 'ides'])
  })

  it('counts the same text differently in the two encodings', async () => {
    const [o200k, cl100k] = await Promise.all([
      loadTokenizer('o200k_base'),
      loadTokenizer('cl100k_base'),
    ])
    const text = 'Tides are rising 潮汐 👨‍👩‍👧'

    expect(o200k.count(text)).toBe(16)
    expect(cl100k.count(text)).toBe(21)
    expect(o200k.count(text)).toBe(o200k.encode(text).length)
  })

  it('round-trips text through encode and decode', async () => {
    const cl100k = await loadTokenizer('cl100k_base')
    const text = 'Selamat pagi, dunia! 1234 \t\n'

    expect(cl100k.decode(cl100k.encode(text))).toBe(text)
  })

  it('loads each encoding once', async () => {
    const [first, second] = await Promise.all([
      loadTokenizer('o200k_base'),
      loadTokenizer('o200k_base'),
    ])

    expect(first).toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.encode('x'))).toBe(true)
  })

  it('refuses an encoding it does not carry', () => {
    expect(() => loadTokenizer('o200k_harmony' as LocalEncoding)).toThrow(TypeError)
    expect(LOCAL_ENCODINGS.values).toEqual(['o200k_base', 'cl100k_base'])
  })
})
