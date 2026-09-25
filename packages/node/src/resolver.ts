/**
 * Name resolution for the Node transport, and the hook that pins a connection
 * to the addresses the guard approved.
 *
 * Checking a name and then connecting by it would resolve it twice: the guard
 * would judge the first answer and the socket would use the second, and a name
 * with a short TTL can change in between. So the transport resolves once, checks
 * every address, and hands Node a `lookup` that can only answer with those.
 */

import dns from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'

/** Every address a hostname resolves to, as IP literals. */
export type Resolver = (hostname: string) => Promise<readonly string[]>

export const systemResolver: Resolver = async (hostname) => {
  const answers = await dns.promises.lookup(hostname, { all: true })
  return answers.map(({ address }) => address)
}

/** The `code` of the error a pinned lookup gives for a hostname it was not built for. */
export const UNPINNED_LOOKUP = 'ERR_VERIFAI_UNPINNED_LOOKUP'

interface PinnedAddress {
  readonly address: string
  readonly family: number
}

function lookupError(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

function requestedFamily(family: dns.LookupOptions['family']): number {
  if (family === 'IPv4') {
    return 4
  }
  if (family === 'IPv6') {
    return 6
  }
  return family ?? 0
}

/**
 * A `lookup` for one connection. It answers only for `expectedHostname`, and
 * only with `addresses`: a request for any other name - which is what a proxy
 * setting would produce - fails the connection instead of resolving somewhere
 * the guard never looked.
 */
export function pinnedLookup(
  expectedHostname: string,
  addresses: readonly string[],
): LookupFunction {
  const expected = expectedHostname.toLowerCase()
  // The family comes from the address itself, so a mislabelled answer cannot
  // send Node down the wrong connect path.
  const pinned: readonly PinnedAddress[] = Object.freeze(
    addresses.map((address) => Object.freeze({ address, family: isIP(address) })),
  )

  return (hostname, options, callback) => {
    if (hostname.toLowerCase() !== expected) {
      callback(
        lookupError(UNPINNED_LOOKUP, 'Lookup for a name this connection is not pinned to'),
        '',
      )
      return
    }

    const family = requestedFamily(options.family)
    const matching = pinned.filter((entry) => family === 0 || entry.family === family)
    const first = matching[0]
    if (first === undefined) {
      callback(lookupError('ENOTFOUND', 'No pinned address of the requested family'), '')
      return
    }

    if (options.all === true) {
      // Copies, because Node owns what it is handed.
      callback(
        null,
        matching.map(({ address, family: entryFamily }) => ({ address, family: entryFamily })),
      )
      return
    }
    callback(null, first.address, first.family)
  }
}
