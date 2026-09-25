import { describe, expect, it } from 'vitest'
import { ADDRESS_RANGES, ADDRESS_SCOPES, classifyAddress } from '../src/net/address.js'

/** `[address, expected range]`, grouped by the scope the range belongs to. */
type Case = readonly [address: string, range: string]

const PUBLIC: readonly Case[] = [
  ['1.1.1.1', 'public'],
  ['8.8.8.8', 'public'],
  ['104.18.6.192', 'public'],
  ['100.63.255.255', 'public'], // one below 100.64/10
  ['100.128.0.0', 'public'], // one above
  ['172.15.255.255', 'public'], // one below 172.16/12
  ['172.32.0.0', 'public'], // one above
  ['223.255.255.255', 'public'], // last unicast before multicast
  ['2606:4700::6810:6c0', 'public'],
  ['2a00:1450:4001:80b::200e', 'public'],
  ['2001:4860:4860::8888', 'public'], // just outside 2001::/23
]

const PRIVATE: readonly Case[] = [
  ['127.0.0.1', 'loopback'],
  ['127.255.255.254', 'loopback'],
  ['::1', 'loopback'],
  ['10.0.0.1', 'private'],
  ['172.16.0.1', 'private'],
  ['172.31.255.255', 'private'],
  ['192.168.1.1', 'private'],
  ['100.64.0.1', 'shared-address'],
  ['100.127.255.255', 'shared-address'],
  ['198.18.0.1', 'benchmarking'],
  ['198.19.255.255', 'benchmarking'],
  ['fc00::1', 'unique-local'],
  ['fd12:3456:789a::1', 'unique-local'],
]

const FORBIDDEN: readonly Case[] = [
  // 0.0.0.0 reaches the local host on Linux, which makes it the classic bypass
  // for a guard that only knows about 127/8.
  ['0.0.0.0', 'this-network'],
  ['0.1.2.3', 'this-network'],
  ['::', 'unspecified'],
  ['169.254.0.1', 'link-local'],
  ['169.254.170.2', 'link-local'], // ECS task metadata
  ['fe80::1', 'link-local'],
  ['febf:ffff::1', 'link-local'],
  // Cloud instance-metadata services, named individually so the refusal says
  // what it protected rather than just "link-local".
  ['169.254.169.254', 'cloud-metadata'], // AWS, GCP, Azure, DigitalOcean
  ['100.100.100.200', 'cloud-metadata'], // Alibaba, inside the shared-address range
  ['192.0.0.192', 'cloud-metadata'], // Oracle, inside the protocol-assignment range
  ['fd00:ec2::254', 'cloud-metadata'], // AWS over IPv6, inside the unique-local range
  ['192.0.0.1', 'protocol-assignments'],
  ['2001::1', 'protocol-assignments'], // Teredo
  ['2001:1ff:ffff::1', 'protocol-assignments'], // last of 2001::/23
  ['192.0.2.1', 'documentation'],
  ['198.51.100.1', 'documentation'],
  ['203.0.113.7', 'documentation'],
  ['2001:db8::1', 'documentation'],
  ['3fff::1', 'documentation'],
  ['192.88.99.1', 'deprecated'],
  ['fec0::1', 'deprecated'], // site-local
  ['::7f00:1', 'deprecated'], // IPv4-compatible
  ['224.0.0.1', 'multicast'],
  ['239.255.255.250', 'multicast'],
  ['ff02::1', 'multicast'],
  ['240.0.0.1', 'reserved'],
  ['255.255.255.255', 'reserved'],
  ['100::1', 'discard'],
  ['64:ff9b:1::a00:1', 'nat64-local'],
  ['5f00::1', 'reserved'], // outside 2000::/3
  ['4000::1', 'reserved'],
]

function expectCases(cases: readonly Case[], scope: string): void {
  for (const [address, range] of cases) {
    expect(classifyAddress(address), address).toEqual({ range, scope })
  }
}

describe('classifyAddress', () => {
  it('admits globally routable unicast, at the edges of every neighbouring range', () => {
    expectCases(PUBLIC, 'public')
  })

  it('marks loopback, private, shared and unique-local space as private', () => {
    expectCases(PRIVATE, 'private')
  })

  it('marks space that can never host a gateway as forbidden', () => {
    expectCases(FORBIDDEN, 'forbidden')
  })

  describe('IPv4 embedded in IPv6', () => {
    it('classifies an IPv4-mapped address by the address it maps', () => {
      // The standard bypass for a guard that only parses dotted quads.
      expect(classifyAddress('::ffff:127.0.0.1')).toEqual({ range: 'loopback', scope: 'private' })
      expect(classifyAddress('::ffff:7f00:1')).toEqual({ range: 'loopback', scope: 'private' })
      expect(classifyAddress('::ffff:169.254.169.254')).toEqual({
        range: 'cloud-metadata',
        scope: 'forbidden',
      })
      expect(classifyAddress('::ffff:8.8.8.8')).toEqual({ range: 'public', scope: 'public' })
    })

    it('classifies well-known-prefix NAT64 by the embedded IPv4', () => {
      // Legitimate on an IPv6-only network, so a public embedded address passes.
      expect(classifyAddress('64:ff9b::8.8.8.8')).toEqual({ range: 'public', scope: 'public' })
      expect(classifyAddress('64:ff9b::a9fe:a9fe')).toEqual({
        range: 'cloud-metadata',
        scope: 'forbidden',
      })
      expect(classifyAddress('64:ff9b::10.0.0.1')).toEqual({ range: 'private', scope: 'private' })
    })

    it('classifies 6to4 by the IPv4 in its second and third groups', () => {
      expect(classifyAddress('2002:0808:0808::1')).toEqual({ range: 'public', scope: 'public' })
      expect(classifyAddress('2002:7f00:0001::1')).toEqual({ range: 'loopback', scope: 'private' })
      expect(classifyAddress('2002:a9fe:a9fe::')).toEqual({
        range: 'cloud-metadata',
        scope: 'forbidden',
      })
    })
  })

  describe('parsing', () => {
    it('reads IPv6 in every textual form, case-insensitively', () => {
      const loopback = { range: 'loopback', scope: 'private' }
      expect(classifyAddress('0:0:0:0:0:0:0:1')).toEqual(loopback)
      expect(classifyAddress('0000:0000:0000:0000:0000:0000:0000:0001')).toEqual(loopback)
      expect(classifyAddress('::0:1')).toEqual(loopback)
      expect(classifyAddress('FD00:EC2::254')).toEqual({
        range: 'cloud-metadata',
        scope: 'forbidden',
      })
      expect(classifyAddress('::FFFF:A9FE:A9FE')).toEqual({
        range: 'cloud-metadata',
        scope: 'forbidden',
      })
    })

    it('refuses an address with a zone identifier', () => {
      // A zone picks an interface, which is a statement about the local network
      // that no public endpoint needs.
      expect(classifyAddress('fe80::1%eth0')).toEqual({ range: 'scoped', scope: 'forbidden' })
      expect(classifyAddress('2606:4700::1%1')).toEqual({ range: 'scoped', scope: 'forbidden' })
    })

    it('fails closed on anything that is not a canonical IP literal', () => {
      // Non-canonical IPv4 is what resolvers and URL parsers disagree about:
      // `010.0.0.1` is octal to some of them and decimal to others. WHATWG URL
      // canonicalises before we see a hostname, so a non-canonical form here
      // means something upstream went wrong - refuse rather than guess.
      const notAnAddress = { range: 'not-an-address', scope: 'forbidden' }
      for (const input of [
        '',
        'localhost',
        'example.com',
        '010.0.0.1',
        '0x7f.0.0.1',
        '2130706433',
        '127.1',
        '1.2.3.4.5',
        '256.0.0.1',
        '1.2.3.-1',
        ' 1.2.3.4',
        '1.2.3.4 ',
        '[::1]',
        ':::1',
        '1::2::3',
        '1:2:3:4:5:6:7:8:9',
        '1:2:3:4:5:6:7',
        '12345::1',
        'g::1',
        '::ffff:1.2.3',
        '::1.2.3.4:5',
        '1:2:3:4:5:6:7::1.2.3.4',
      ]) {
        expect(classifyAddress(input), JSON.stringify(input)).toEqual(notAnAddress)
      }
    })
  })

  it('only ever returns a declared range and scope', () => {
    for (const [address] of [...PUBLIC, ...PRIVATE, ...FORBIDDEN]) {
      const { range, scope } = classifyAddress(address)
      expect(ADDRESS_RANGES.has(range)).toBe(true)
      expect(ADDRESS_SCOPES.has(scope)).toBe(true)
    }
  })

  it('returns frozen results, so a caller cannot rewrite a verdict it was handed', () => {
    expect(Object.isFrozen(classifyAddress('10.0.0.1'))).toBe(true)
  })
})
