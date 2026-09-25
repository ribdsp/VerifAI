/**
 * The endpoint URL a buyer typed, reduced to what the transport may act on.
 *
 * Parsing is WHATWG `URL`, the same parser every runtime ships, so the hostname
 * judged here is the hostname a socket would be opened for: `0x7f.1`,
 * `2130706433` and `127.1` all arrive canonicalised to `127.0.0.1` before the
 * classifier sees them. Names are left to the resolver - checking the string
 * `localhost` here would be a weaker copy of the check the transport runs on
 * every resolved address - but an address literal never reaches a resolver, so
 * it is judged now.
 */

import { type AddressClass, classifyAddress } from './address.js'
import { admitsScope, type RefusedScope, type TargetPolicy } from './guard.js'

export interface TargetUrl {
  /** Normalised, without a fragment. */
  readonly href: string
  readonly protocol: 'http:' | 'https:'
  /** What to connect to. An IPv6 literal appears without its brackets. */
  readonly hostname: string
  /** The `Host` header value: brackets kept, port included only when non-default. */
  readonly host: string
  readonly port: number
  /** Path and query, as sent on the request line. */
  readonly path: string
  /** The classification when `hostname` is an address literal. */
  readonly addressLiteral: AddressClass | undefined
}

export type TargetUrlProblem =
  | 'not-a-url'
  | 'unsupported-scheme'
  | 'embedded-credentials'
  | 'blocked-address'

export type TargetUrlResult =
  | { readonly ok: true; readonly target: TargetUrl }
  | { readonly ok: false; readonly problem: Exclude<TargetUrlProblem, 'blocked-address'> }
  | { readonly ok: false; readonly problem: 'blocked-address'; readonly scope: RefusedScope }

const DEFAULT_PORTS = { 'http:': 80, 'https:': 443 } as const

function isSupportedProtocol(protocol: string): protocol is keyof typeof DEFAULT_PORTS {
  return Object.hasOwn(DEFAULT_PORTS, protocol)
}

function failure(problem: Exclude<TargetUrlProblem, 'blocked-address'>): TargetUrlResult {
  return Object.freeze({ ok: false, problem })
}

function parse(input: string): URL | undefined {
  try {
    return new URL(input)
  } catch {
    // `URL` throws a TypeError whose only content is "Invalid URL"; the input
    // itself is what the caller gets back as context, so nothing is lost here.
    return undefined
  }
}

/** `URL.hostname` keeps the brackets of an IPv6 literal; a socket wants them gone. */
function bareHostname(hostname: string): { readonly bare: string; readonly isIpv6: boolean } {
  const isIpv6 = hostname.startsWith('[') && hostname.endsWith(']')
  return { bare: isIpv6 ? hostname.slice(1, -1) : hostname, isIpv6 }
}

/** An IPv4 literal is all digits and dots once the URL parser has canonicalised it. */
const CANONICAL_IPV4 = /^\d+\.\d+\.\d+\.\d+$/

export function parseTargetUrl(input: string, policy: TargetPolicy): TargetUrlResult {
  const url = parse(input)
  if (url === undefined) {
    return failure('not-a-url')
  }
  if (!isSupportedProtocol(url.protocol)) {
    return failure('unsupported-scheme')
  }
  // Credentials in a URL end up in logs and reports verbatim, and the key has
  // its own channel: an environment variable or a prompt.
  if (url.username !== '' || url.password !== '') {
    return failure('embedded-credentials')
  }
  if (url.hostname === '') {
    return failure('not-a-url')
  }

  const { bare, isIpv6 } = bareHostname(url.hostname)
  const addressLiteral = isIpv6 || CANONICAL_IPV4.test(bare) ? classifyAddress(bare) : undefined
  if (addressLiteral !== undefined && !admitsScope(addressLiteral.scope, policy)) {
    const scope: RefusedScope = addressLiteral.scope === 'private' ? 'private' : 'forbidden'
    return Object.freeze({ ok: false, problem: 'blocked-address', scope })
  }

  const port = url.port === '' ? DEFAULT_PORTS[url.protocol] : Number(url.port)
  const target: TargetUrl = Object.freeze({
    href: `${url.origin}${url.pathname}${url.search}`,
    protocol: url.protocol,
    hostname: bare,
    host: url.host,
    port,
    path: `${url.pathname}${url.search}`,
    addressLiteral,
  })
  return Object.freeze({ ok: true, target })
}
