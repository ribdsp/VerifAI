import { describe, expect, it } from 'vitest'
import {
  PAIRINGS,
  PROTOCOLS,
  pairingOf,
  protocolOwner,
  recommendedProtocolsFor,
  VENDORS,
} from '../src/types/target.js'

describe('protocol / vendor pairing', () => {
  it('assigns every protocol to exactly one owning vendor', () => {
    for (const protocol of PROTOCOLS.values) {
      expect(VENDORS.has(protocolOwner(protocol))).toBe(true)
    }
  })

  it('treats a vendor served over its own protocol as a native pairing', () => {
    expect(pairingOf('anthropic-messages', 'anthropic')).toBe('native')
    expect(pairingOf('openai-chat', 'openai')).toBe('native')
    expect(pairingOf('openai-responses', 'openai')).toBe('native')
  })

  it('treats Claude sold over an OpenAI-shaped route as cross-protocol', () => {
    // Extremely common in the reseller market, and supported - just under a
    // lower confidence ceiling, because translation erases vendor signals.
    expect(pairingOf('openai-chat', 'anthropic')).toBe('cross-protocol')
    expect(pairingOf('openai-responses', 'anthropic')).toBe('cross-protocol')
  })

  it('treats GPT sold over the Anthropic Messages route as cross-protocol', () => {
    expect(pairingOf('anthropic-messages', 'openai')).toBe('cross-protocol')
  })

  it('returns a declared pairing for every protocol / vendor combination', () => {
    for (const protocol of PROTOCOLS.values) {
      for (const vendor of VENDORS.values) {
        expect(PAIRINGS.has(pairingOf(protocol, vendor))).toBe(true)
      }
    }
  })

  it('recommends only the vendor-native protocols for each vendor', () => {
    expect(recommendedProtocolsFor('anthropic')).toEqual(['anthropic-messages'])
    expect(recommendedProtocolsFor('openai')).toEqual(['openai-chat', 'openai-responses'])
  })

  it('recommends at least one protocol for every vendor', () => {
    for (const vendor of VENDORS.values) {
      expect(recommendedProtocolsFor(vendor).length).toBeGreaterThan(0)
    }
  })

  it('throws on a protocol from outside the vocabulary rather than guessing', () => {
    // How this arrives in practice: an unvalidated CLI flag or JSON field cast to
    // `Protocol`. The old lookup returned `undefined` typed as `Vendor`, which
    // compared unequal to every vendor and reported a native pairing as
    // cross-protocol - a wrong confidence ceiling derived from a bad input.
    const bogus = 'openai-completions' as unknown as 'openai-chat'

    expect(() => protocolOwner(bogus)).toThrow(TypeError)
    expect(() => protocolOwner(bogus)).toThrow(/Unknown protocol "openai-completions"/)
    expect(() => pairingOf(bogus, 'openai')).toThrow(TypeError)
    expect(PROTOCOLS.has(bogus)).toBe(false)
  })
})
