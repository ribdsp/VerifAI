import net from 'node:net'

/**
 * Fails any test that reaches the network.
 *
 * VerifAI's probes exist to talk to third-party AI endpoints, which means an
 * accidentally-unmocked call in the test suite spends the developer's money,
 * leaks whichever key happens to be in the environment, and produces a flaky
 * result. Fixtures and local fake servers only.
 *
 * Fake servers are real `node:http` servers on loopback, not an interceptor.
 * The Tier-0 probes measure header casing, header order, duplicate headers and
 * byte-level JSON whitespace, and an interceptor that parses and re-serialises
 * a response destroys exactly those.
 *
 * Two layers, because there are two ways out:
 *
 * - `globalThis.fetch` is replaced, so a call from our own code fails early with
 *   a message that says why.
 * - `net.Socket.prototype.connect` is replaced, which is what `node:http`,
 *   `node:https`, `node:tls` and undici's `fetch` all end in. That covers the
 *   Node transport, and any library that captured the real `fetch` before this
 *   file ran.
 *
 * Known limit, stated rather than implied: DNS is not guarded. A test that hands
 * a public hostname to a transport without injecting a resolver performs a real
 * lookup before the socket guard refuses the connection. The transport's tests
 * inject their resolver for that reason, and never rely on this file to do it.
 */

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1'])

const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

/**
 * Derived from `fetch` itself rather than written as `RequestInfo`, which is not
 * a global in every `@types/node` line and would tie this file to one of them.
 */
type FetchInput = Parameters<typeof globalThis.fetch>[0]
type FetchInit = Parameters<typeof globalThis.fetch>[1]

function isLoopback(hostname: string): boolean {
  // `URL.hostname` keeps the brackets on an IPv6 literal.
  const bracketed = hostname.startsWith('[') && hostname.endsWith(']')
  const bare = bracketed ? hostname.slice(1, -1) : hostname

  return LOOPBACK_HOSTNAMES.has(bare) || IPV4_LOOPBACK.test(bare)
}

function blocked(target: string): Error {
  return new Error(
    `Blocked network request to ${target} from a test.\n` +
      'Tests must not reach the network: replay a fixture, or stand up a local ' +
      'fake server on loopback. If you are adding a deliberate live-endpoint ' +
      'check, it belongs behind an explicit opt-in script, not in `pnpm run test`.',
  )
}

function targetUrl(input: FetchInput): URL {
  if (typeof input === 'string') {
    return new URL(input)
  }
  if (input instanceof URL) {
    return input
  }
  return new URL(input.url)
}

const realFetch = globalThis.fetch

globalThis.fetch = (async (input: FetchInput, init?: FetchInit): Promise<Response> => {
  const url = targetUrl(input)

  if (!isLoopback(url.hostname)) {
    throw blocked(url.origin)
  }

  return realFetch(input, init)
}) as typeof globalThis.fetch

/**
 * The host a `Socket#connect` call is aimed at, or `undefined` for an IPC path,
 * which is local by definition. Mirrors Node's own argument normalisation:
 * `connect(options)`, `connect(port, host?)`, `connect(path)`, and the
 * pre-normalised array that `net.createConnection` passes internally.
 */
function connectHost(args: readonly unknown[]): string | undefined {
  const first: unknown = Array.isArray(args[0]) ? args[0][0] : args[0]

  if (typeof first === 'object' && first !== null) {
    const options = first as { readonly path?: unknown; readonly host?: unknown }
    if (typeof options.path === 'string') {
      return undefined
    }
    return typeof options.host === 'string' ? options.host : 'localhost'
  }
  // A non-numeric string is a pipe name; a numeric one is a port.
  if (typeof first === 'string' && Number.isNaN(Number(first))) {
    return undefined
  }
  return typeof args[1] === 'string' ? args[1] : 'localhost'
}

const realConnect = net.Socket.prototype.connect

net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
  const host = connectHost(args)

  if (host !== undefined && !isLoopback(host)) {
    throw blocked(host)
  }

  return Reflect.apply(realConnect, this, args)
} as typeof realConnect
