import {
  documented,
  type FactSource,
  fact,
  MAX_QUOTE_LENGTH,
  RETRIEVED_AT,
  type Sources,
  source,
} from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'

const PAGE = 'https://platform.claude.com/docs/en/api/errors'
const CITED: Sources = [source(PAGE, 'A quote.')]

describe('source', () => {
  it('trims the quote, defaults the retrieval date and freezes the result', () => {
    const cited = source(PAGE, '  A quoted sentence.\n')

    expect(cited).toEqual({ url: PAGE, quote: 'A quoted sentence.', retrievedAt: RETRIEVED_AT })
    expect(Object.isFrozen(cited)).toBe(true)
  })

  it('keeps an explicit retrieval date', () => {
    expect(source(PAGE, 'A quote.', '2026-01-31').retrievedAt).toBe('2026-01-31')
  })

  it('accepts a quote of exactly the maximum length', () => {
    expect(source(PAGE, 'x'.repeat(MAX_QUOTE_LENGTH)).quote).toHaveLength(MAX_QUOTE_LENGTH)
  })

  it.each([
    ['a relative URL', 'docs/en/api/errors', 'A quote.', RETRIEVED_AT, 'must be absolute'],
    [
      'an http URL',
      'http://platform.claude.com/docs/en/api/errors',
      'A quote.',
      RETRIEVED_AT,
      'https',
    ],
    ['a javascript URL', 'javascript:void(0)', 'A quote.', RETRIEVED_AT, 'https'],
    ['a blank quote', PAGE, ' \n\t ', RETRIEVED_AT, 'empty quote'],
    ['an overlong quote', PAGE, 'x'.repeat(MAX_QUOTE_LENGTH + 1), RETRIEVED_AT, 'more than 1200'],
    ['month 13', PAGE, 'A quote.', '2026-13-01', 'YYYY-MM-DD'],
    ['day 32', PAGE, 'A quote.', '2026-09-32', 'YYYY-MM-DD'],
    ['a timestamp', PAGE, 'A quote.', '2026-09-24T00:00:00Z', 'YYYY-MM-DD'],
  ])('rejects %s', (_, url, quote, retrievedAt, message) => {
    const attempt = () => source(url, quote, retrievedAt)

    expect(attempt).toThrow(TypeError)
    expect(attempt).toThrow(message)
  })
})

describe('fact', () => {
  it('freezes the fact, its source list and a record value', () => {
    const value = { inputPerMTok: 1 }

    const made = fact('derived', value, CITED, 'Why the quote supports it.')

    expect(made).toEqual({
      value: { inputPerMTok: 1 },
      calibration: 'derived',
      sources: CITED,
      note: 'Why the quote supports it.',
    })
    expect(Object.isFrozen(made)).toBe(true)
    expect(Object.isFrozen(made.sources)).toBe(true)
    expect(Object.isFrozen(value)).toBe(true)
  })

  it("copies the source list rather than holding the caller's array", () => {
    const list: [FactSource, ...FactSource[]] = [source(PAGE, 'First.')]

    const made = fact('heuristic', 1, list)
    list.push(source(PAGE, 'Added later.'))

    expect(made.sources).toHaveLength(1)
  })

  it('leaves out the note key when there is no note', () => {
    expect(Object.hasOwn(fact('heuristic', true, CITED), 'note')).toBe(false)
  })

  it('passes primitives and null through', () => {
    expect(fact('heuristic', null, CITED).value).toBeNull()
    expect(fact('heuristic', 'claude-2026', CITED).value).toBe('claude-2026')
  })

  it('rejects an empty source list', () => {
    const empty = [] as unknown as Sources

    expect(() => fact('documented', true, empty)).toThrow(TypeError)
    expect(() => fact('documented', true, empty)).toThrow('at least one source')
  })

  it('rejects a blank note', () => {
    expect(() => fact('documented', true, CITED, '  ')).toThrow('must not be blank')
  })
})

describe('documented', () => {
  it('is a fact with the documented calibration', () => {
    expect(documented(512, CITED, 'A note.')).toEqual({
      value: 512,
      calibration: 'documented',
      sources: CITED,
      note: 'A note.',
    })
  })
})
