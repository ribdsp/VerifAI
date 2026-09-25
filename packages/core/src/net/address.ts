/**
 * Where an IP address sits, for the outbound SSRF guard.
 *
 * VerifAI takes a URL from its user and connects to it while holding a
 * third-party credential, so an address has to be judged before any socket is
 * opened. Three scopes, because two kinds of refusal exist:
 *
 * - `public` - globally routable unicast. Always admitted.
 * - `private` - loopback, RFC 1918, shared (CGNAT) and unique-local space. A
 *   buyer's own gateway can legitimately live here - LiteLLM on `localhost` is
 *   the common case - so `--allow-private-targets` admits this scope for one
 *   run.
 * - `forbidden` - space that cannot host an AI gateway: unspecified, link-local,
 *   cloud instance metadata, multicast, documentation, deprecated and reserved
 *   ranges. No flag admits these. A metadata service is the whole prize of an
 *   SSRF, and nothing a buyer is testing has ever lived on one.
 *
 * Input is a canonical IP literal: what a resolver returns, or what a WHATWG
 * `URL` leaves in `hostname` once the brackets of an IPv6 literal are removed.
 * Anything else fails closed as `not-an-address`. That includes non-canonical
 * IPv4 such as `010.0.0.1`, which is octal to some parsers and decimal to
 * others - the exact disagreement a bypass is built from.
 */

import { type Member, vocabulary } from '../types/vocabulary.js'

export const ADDRESS_SCOPES = vocabulary(['public', 'private', 'forbidden'])
export type AddressScope = Member<typeof ADDRESS_SCOPES>

export const ADDRESS_RANGES = vocabulary([
  'public',
  'loopback',
  'private',
  'shared-address',
  'benchmarking',
  'unique-local',
  'unspecified',
  'this-network',
  'link-local',
  'cloud-metadata',
  'protocol-assignments',
  'documentation',
  'deprecated',
  'multicast',
  'reserved',
  'discard',
  'nat64-local',
  'scoped',
  'not-an-address',
])
export type AddressRange = Member<typeof ADDRESS_RANGES>

export interface AddressClass {
  readonly range: AddressRange
  readonly scope: AddressScope
}

const PRIVATE_RANGES: ReadonlySet<AddressRange> = new Set([
  'loopback',
  'private',
  'shared-address',
  'benchmarking',
  'unique-local',
])

/** One frozen result per range, so a caller cannot rewrite a verdict it was handed. */
const CLASSES: ReadonlyMap<AddressRange, AddressClass> = new Map(
  ADDRESS_RANGES.values.map((range) => {
    const scope: AddressScope =
      range === 'public' ? 'public' : PRIVATE_RANGES.has(range) ? 'private' : 'forbidden'
    return [range, Object.freeze({ range, scope })]
  }),
)

function classOf(range: AddressRange): AddressClass {
  const found = CLASSES.get(range)
  if (found === undefined) {
    throw new Error(`No class for address range ${range}`)
  }
  return found
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** 0-255 with no leading zero, which is what keeps octal readings out. */
const IPV4_OCTET = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)$/
const HEX_GROUP = /^[0-9a-f]{1,4}$/i
const IPV6_GROUPS = 8

/** A dotted quad as an unsigned 32-bit number, or `undefined`. */
function parseIpv4(text: string): number | undefined {
  const octets = text.split('.')
  if (octets.length !== 4) {
    return undefined
  }

  let value = 0
  for (const octet of octets) {
    if (!IPV4_OCTET.test(octet)) {
      return undefined
    }
    value = value * 256 + Number(octet)
  }
  return value
}

/**
 * Colon-separated pieces as 16-bit groups. Only the final piece of an address
 * may be a dotted quad, so `allowIpv4Tail` is false for the half before `::`.
 */
function parseGroups(pieces: readonly string[], allowIpv4Tail: boolean): number[] | undefined {
  const groups: number[] = []

  for (const [at, piece] of pieces.entries()) {
    if (allowIpv4Tail && at === pieces.length - 1 && piece.includes('.')) {
      const ipv4 = parseIpv4(piece)
      if (ipv4 === undefined) {
        return undefined
      }
      groups.push(Math.floor(ipv4 / 0x10000), ipv4 % 0x10000)
    } else if (HEX_GROUP.test(piece)) {
      groups.push(Number.parseInt(piece, 16))
    } else {
      return undefined
    }
  }
  return groups
}

function splitPieces(text: string): string[] {
  return text === '' ? [] : text.split(':')
}

/** Eight 16-bit groups, or `undefined`. Accepts `::` compression and an IPv4 tail. */
function parseIpv6(text: string): readonly number[] | undefined {
  const halves = text.split('::')

  if (halves.length === 1) {
    const groups = parseGroups(splitPieces(text), true)
    return groups?.length === IPV6_GROUPS ? groups : undefined
  }
  if (halves.length !== 2) {
    return undefined
  }

  const head = parseGroups(splitPieces(halves[0] ?? ''), false)
  const tail = parseGroups(splitPieces(halves[1] ?? ''), true)
  if (head === undefined || tail === undefined) {
    return undefined
  }

  // `::` stands for at least one group of zeros.
  const zeros = IPV6_GROUPS - head.length - tail.length
  if (zeros < 1) {
    return undefined
  }
  return [...head, ...new Array<number>(zeros).fill(0), ...tail]
}

// ---------------------------------------------------------------------------
// Range tables
// ---------------------------------------------------------------------------

/** Parses a table entry at module load, so a typo fails the import instead of a check. */
function cidr(text: string): { readonly address: string; readonly bits: number } {
  const [address, bits, extra] = text.split('/')
  const prefix = Number(bits)

  if (address === undefined || extra !== undefined || !Number.isInteger(prefix) || prefix < 0) {
    throw new Error(`Malformed CIDR in address table: ${text}`)
  }
  return { address, bits: prefix }
}

interface Ipv4Rule {
  readonly base: number
  readonly bits: number
  readonly range: AddressRange
}

function ipv4Rule(text: string, range: AddressRange): Ipv4Rule {
  const { address, bits } = cidr(text)
  const base = parseIpv4(address)

  if (base === undefined || bits > 32) {
    throw new Error(`Malformed IPv4 rule in address table: ${text}`)
  }
  return { base, bits, range }
}

/** First match wins, so single addresses come before the ranges containing them. */
const IPV4_RULES: readonly Ipv4Rule[] = [
  ipv4Rule('169.254.169.254/32', 'cloud-metadata'), // AWS, GCP, Azure, DigitalOcean
  ipv4Rule('100.100.100.200/32', 'cloud-metadata'), // Alibaba Cloud
  ipv4Rule('192.0.0.192/32', 'cloud-metadata'), // Oracle Cloud
  ipv4Rule('0.0.0.0/8', 'this-network'), // RFC 1122; 0.0.0.0 reaches the local host on Linux
  ipv4Rule('10.0.0.0/8', 'private'), // RFC 1918
  ipv4Rule('100.64.0.0/10', 'shared-address'), // RFC 6598, carrier-grade NAT
  ipv4Rule('127.0.0.0/8', 'loopback'), // RFC 1122
  ipv4Rule('169.254.0.0/16', 'link-local'), // RFC 3927
  ipv4Rule('172.16.0.0/12', 'private'), // RFC 1918
  ipv4Rule('192.0.0.0/24', 'protocol-assignments'), // RFC 6890
  ipv4Rule('192.0.2.0/24', 'documentation'), // RFC 5737
  ipv4Rule('192.88.99.0/24', 'deprecated'), // RFC 7526, 6to4 relay anycast
  ipv4Rule('192.168.0.0/16', 'private'), // RFC 1918
  ipv4Rule('198.18.0.0/15', 'benchmarking'), // RFC 2544
  ipv4Rule('198.51.100.0/24', 'documentation'), // RFC 5737
  ipv4Rule('203.0.113.0/24', 'documentation'), // RFC 5737
  ipv4Rule('224.0.0.0/4', 'multicast'), // RFC 5771
  ipv4Rule('240.0.0.0/4', 'reserved'), // RFC 1112, including broadcast
]

function classifyIpv4(value: number): AddressClass {
  for (const rule of IPV4_RULES) {
    const size = 2 ** (32 - rule.bits)
    if (Math.floor(value / size) === Math.floor(rule.base / size)) {
      return classOf(rule.range)
    }
  }
  return classOf('public')
}

/**
 * What an IPv6 rule concludes: a range directly, or "read the IPv4 embedded at
 * this group offset". The embedded forms are the classic bypass - an IPv4-mapped
 * `::ffff:169.254.169.254` is the metadata service, whatever the outer prefix.
 */
type Ipv6Outcome = AddressRange | { readonly embeddedAt: number }

interface Ipv6Rule {
  readonly prefix: readonly number[]
  readonly bits: number
  readonly outcome: Ipv6Outcome
}

function ipv6Rule(text: string, outcome: Ipv6Outcome): Ipv6Rule {
  const { address, bits } = cidr(text)
  const prefix = parseIpv6(address)

  if (prefix === undefined || bits > 128) {
    throw new Error(`Malformed IPv6 rule in address table: ${text}`)
  }
  return { prefix, bits, outcome }
}

const LAST_32_BITS = { embeddedAt: 6 }

/** First match wins. Everything outside 2000::/3 that no rule names is `reserved`. */
const IPV6_RULES: readonly Ipv6Rule[] = [
  ipv6Rule('::/128', 'unspecified'),
  ipv6Rule('::1/128', 'loopback'),
  ipv6Rule('::ffff:0:0/96', LAST_32_BITS), // RFC 4291, IPv4-mapped
  ipv6Rule('::/96', 'deprecated'), // RFC 4291, IPv4-compatible
  ipv6Rule('64:ff9b::/96', LAST_32_BITS), // RFC 6052, well-known NAT64 prefix
  ipv6Rule('64:ff9b:1::/48', 'nat64-local'), // RFC 8215; embedding position is operator-chosen
  ipv6Rule('100::/64', 'discard'), // RFC 6666
  ipv6Rule('2001:db8::/32', 'documentation'), // RFC 3849
  ipv6Rule('2001::/23', 'protocol-assignments'), // RFC 2928, including Teredo
  ipv6Rule('2002::/16', { embeddedAt: 1 }), // RFC 3056, 6to4
  ipv6Rule('3fff::/20', 'documentation'), // RFC 9637
  ipv6Rule('2000::/3', 'public'), // global unicast
  ipv6Rule('fd00:ec2::254/128', 'cloud-metadata'), // AWS instance metadata over IPv6
  ipv6Rule('fc00::/7', 'unique-local'), // RFC 4193
  ipv6Rule('fe80::/10', 'link-local'), // RFC 4291
  ipv6Rule('fec0::/10', 'deprecated'), // RFC 3879, site-local
  ipv6Rule('ff00::/8', 'multicast'), // RFC 4291
]

function hasPrefix(groups: readonly number[], rule: Ipv6Rule): boolean {
  let remaining = rule.bits

  for (let at = 0; remaining > 0; at += 1, remaining -= 16) {
    const group = groups[at] ?? 0
    const expected = rule.prefix[at] ?? 0
    const shift = Math.max(0, 16 - remaining)

    if (group >> shift !== expected >> shift) {
      return false
    }
  }
  return true
}

function classifyIpv6(groups: readonly number[]): AddressClass {
  const rule = IPV6_RULES.find((candidate) => hasPrefix(groups, candidate))

  if (rule === undefined) {
    return classOf('reserved')
  }
  if (typeof rule.outcome === 'string') {
    return classOf(rule.outcome)
  }

  const high = groups[rule.outcome.embeddedAt] ?? 0
  const low = groups[rule.outcome.embeddedAt + 1] ?? 0
  return classifyIpv4(high * 0x10000 + low)
}

/**
 * Classifies one IP literal. Total: every input gets a class, and anything that
 * is not a canonical address is `forbidden`.
 */
export function classifyAddress(address: string): AddressClass {
  const ipv4 = parseIpv4(address)
  if (ipv4 !== undefined) {
    return classifyIpv4(ipv4)
  }

  // A zone selects a local interface, which no public endpoint needs.
  const zone = address.indexOf('%')
  if (zone !== -1) {
    return classOf(parseIpv6(address.slice(0, zone)) === undefined ? 'not-an-address' : 'scoped')
  }

  const ipv6 = parseIpv6(address)
  return ipv6 === undefined ? classOf('not-an-address') : classifyIpv6(ipv6)
}
