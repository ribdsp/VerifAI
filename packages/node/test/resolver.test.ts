import type { LookupAddress } from 'node:dns'
import { describe, expect, it } from 'vitest'
import { pinnedLookup } from '../src/resolver.js'

const ADDRESSES = ['104.18.6.192', '2606:4700::6810:6c0'] as const

interface Answer {
  readonly error: NodeJS.ErrnoException | null
  readonly address: string | LookupAddress[]
  readonly family: number | undefined
}

function ask(
  lookup: ReturnType<typeof pinnedLookup>,
  hostname: string,
  options: { all?: boolean; family?: number },
): Answer {
  let answer: Answer | undefined
  lookup(hostname, options, (error, address, family) => {
    answer = { error, address, family }
  })
  if (answer === undefined) {
    throw new Error('lookup did not call back synchronously')
  }
  return answer
}

describe('pinnedLookup', () => {
  const lookup = pinnedLookup('api.example.com', ADDRESSES)

  it('answers the all-addresses form Node uses for happy eyeballs', () => {
    expect(ask(lookup, 'api.example.com', { all: true })).toEqual({
      error: null,
      address: [
        { address: '104.18.6.192', family: 4 },
        { address: '2606:4700::6810:6c0', family: 6 },
      ],
      family: undefined,
    })
  })

  it('answers the single-address form with the first checked address', () => {
    expect(ask(lookup, 'api.example.com', {})).toEqual({
      error: null,
      address: '104.18.6.192',
      family: 4,
    })
  })

  it('derives each family from the address rather than trusting a label', () => {
    expect(
      ask(pinnedLookup('api.example.com', ['2606:4700::6810:6c0']), 'api.example.com', {}),
    ).toMatchObject({ address: '2606:4700::6810:6c0', family: 6 })
  })

  it('honours a family restriction without inventing an address', () => {
    expect(ask(lookup, 'api.example.com', { family: 6 })).toMatchObject({
      address: '2606:4700::6810:6c0',
      family: 6,
    })
    const none = ask(pinnedLookup('api.example.com', [ADDRESSES[0]]), 'api.example.com', {
      family: 6,
      all: true,
    })
    expect(none.error?.code).toBe('ENOTFOUND')
  })

  it('matches the hostname the way DNS does, ignoring case', () => {
    expect(ask(lookup, 'API.Example.COM', {}).error).toBeNull()
  })

  it('refuses to answer for any other hostname', () => {
    // If Node ever resolves something we did not check - a proxy host, say -
    // the connection must fail rather than quietly go somewhere unguarded.
    const answer = ask(lookup, 'evil.example.net', { all: true })
    expect(answer.error?.code).toBe('ERR_VERIFAI_UNPINNED_LOOKUP')
  })

  it('never resolves anything itself', () => {
    // Every answer comes from the list it was built with, so a second
    // resolution cannot move the connection somewhere the guard never saw.
    const answers = [
      ask(lookup, 'api.example.com', { all: true }),
      ask(lookup, 'api.example.com', { all: true }),
    ]
    expect(answers[0]).toEqual(answers[1])
  })
})
