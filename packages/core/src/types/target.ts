/**
 * Vendor, wire protocol, and the relationship between them.
 *
 * A reseller endpoint has two independent properties: the protocol it speaks and
 * the vendor of the model it claims to serve. They are routinely mismatched in the
 * wild - Claude models sold over `/v1/chat/completions`, GPT models sold over
 * `/v1/messages` - so the code never infers one from the other.
 */

import { type Member, vocabulary } from './vocabulary.js'

/** The two model vendors VerifAI knows how to verify. */
export const VENDORS = vocabulary(['anthropic', 'openai'])
export type Vendor = Member<typeof VENDORS>

/** Wire protocols a third-party endpoint may expose. */
export const PROTOCOLS = vocabulary(['anthropic-messages', 'openai-chat', 'openai-responses'])
export type Protocol = Member<typeof PROTOCOLS>

/**
 * Whether the claimed model's vendor owns the protocol it is being served over.
 *
 * `native` pairings expose the full probe catalogue, because a genuine backend
 * must reproduce that vendor's own validation layer byte for byte. A
 * `cross-protocol` pairing necessarily passes through a translation layer, which
 * erases many vendor-specific signals - so those runs are still verified, but
 * under a lower confidence ceiling rather than being refused.
 */
export const PAIRINGS = vocabulary(['native', 'cross-protocol'])
export type Pairing = Member<typeof PAIRINGS>

/** The vendor whose own documentation defines each protocol. */
const PROTOCOL_OWNER: Readonly<Record<Protocol, Vendor>> = Object.freeze({
  'anthropic-messages': 'anthropic',
  'openai-chat': 'openai',
  'openai-responses': 'openai',
})

/**
 * @throws TypeError if `protocol` is not a known protocol.
 *
 * The throw is the point. Protocols arrive from CLI flags, HTTP bodies and
 * replayed fixtures, and `PROTOCOL_OWNER[untrusted]` returns `undefined` while the
 * type system insists the result is a `Vendor`. That `undefined` then flows into
 * `pairingOf`, compares unequal to everything, and silently reports a native
 * pairing as `cross-protocol` - a wrong confidence ceiling derived from a value
 * that was never valid. Validate untrusted input with `PROTOCOLS.has` first.
 */
export function protocolOwner(protocol: Protocol): Vendor {
  const owner = PROTOCOL_OWNER[protocol]

  if (owner === undefined) {
    throw new TypeError(
      `Unknown protocol ${JSON.stringify(protocol)}; expected one of ${PROTOCOLS.values.join(', ')}`,
    )
  }

  return owner
}

export function pairingOf(protocol: Protocol, claimedVendor: Vendor): Pairing {
  return protocolOwner(protocol) === claimedVendor ? 'native' : 'cross-protocol'
}

/** The protocol a buyer should prefer for a given vendor, for the README's recommendation. */
export function recommendedProtocolsFor(vendor: Vendor): readonly Protocol[] {
  return PROTOCOLS.values.filter((protocol) => protocolOwner(protocol) === vendor)
}
