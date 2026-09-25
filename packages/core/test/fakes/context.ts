/**
 * A `ProbeContext` without a runner, for testing one probe at a time.
 *
 * A probe only ever sees `send`, so a probe test answers `ProbeRequest`s
 * directly: no URL table, no key, no budget. What the runner does with the same
 * requests - retries, stops, evidence - is the runner's tests' business.
 */

import { type Endpoint, parseEndpoint } from '../../src/adapters/endpoint.js'
import type { Exchange, ProbeContext, ProbeRequest, ProbeTarget } from '../../src/probes/types.js'
import { toExchange } from '../../src/runner/exchange.js'
import type { HeaderPair } from '../../src/transport/types.js'
import { type Protocol, pairingOf, protocolOwner, type Vendor } from '../../src/types/target.js'
import { response } from './transport.js'

export interface TargetOptions {
  readonly protocol?: Protocol
  /** Defaults to the protocol's owner. */
  readonly vendor?: Vendor
  readonly model?: string
  /** The name requests carry, when a gateway sells `model` under its own. Defaults to `model`. */
  readonly requestedModel?: string
  readonly endpoint?: string
}

const DEFAULT_MODELS: Readonly<Record<Vendor, string>> = Object.freeze({
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
})

const DEFAULT_ENDPOINTS: Readonly<Record<Vendor, string>> = Object.freeze({
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
})

function endpointOf(url: string): Endpoint {
  const parsed = parseEndpoint(url)
  if (!parsed.ok) {
    throw new TypeError(`Not an endpoint: ${parsed.problem}`)
  }
  return parsed.endpoint
}

export function probeTarget(options: TargetOptions = {}): ProbeTarget {
  const protocol = options.protocol ?? 'anthropic-messages'
  const owner = protocolOwner(protocol)
  const vendor = options.vendor ?? owner
  const model = options.model ?? DEFAULT_MODELS[vendor]
  return Object.freeze({
    endpoint: endpointOf(options.endpoint ?? DEFAULT_ENDPOINTS[owner]),
    protocol,
    claimedVendor: vendor,
    claimedModel: model,
    requestedModel: options.requestedModel ?? model,
    pairing: pairingOf(protocol, vendor),
  })
}

/**
 * What the fake endpoint does with one request: answer it, or fail it with a
 * runner error such as `new ProbeLost()`. `index` counts from 0, in send order.
 */
export type ProbeAnswer = (
  request: ProbeRequest,
  index: number,
) => Exchange | Error | Promise<Exchange | Error>

export interface ContextOptions extends TargetOptions {
  readonly target?: ProbeTarget
  readonly hasKey?: boolean
  readonly nonce?: string
  readonly signal?: AbortSignal
}

export interface FakeContext {
  readonly context: ProbeContext
  /** Every request sent so far, in order. */
  readonly requests: readonly ProbeRequest[]
}

export function probeContext(answer: ProbeAnswer, options: ContextOptions = {}): FakeContext {
  const requests: ProbeRequest[] = []
  const cache = new Map<string, Promise<unknown>>()
  const context: ProbeContext = Object.freeze({
    target: options.target ?? probeTarget(options),
    hasKey: options.hasKey ?? true,
    nonce: options.nonce ?? 'n0nce7test',
    signal: options.signal ?? new AbortController().signal,
    send: async (request: ProbeRequest) => {
      const index = requests.length
      requests.push(request)
      const outcome = await answer(request, index)
      if (outcome instanceof Error) {
        throw outcome
      }
      return outcome
    },
    shared: <T>(key: string, compute: () => Promise<T>): Promise<T> => {
      const cached = cache.get(key)
      if (cached !== undefined) {
        return cached as Promise<T>
      }
      // As the runner does: a failed computation is not kept, so the next caller tries again.
      const computed = compute()
      cache.set(key, computed)
      computed.catch(() => cache.delete(key))
      return computed
    },
  })
  return {
    context,
    get requests() {
      return Object.freeze([...requests])
    },
  }
}

/** Answers in sequence: the n-th request gets the n-th answer, and the last repeats. */
export function inOrder(...answers: readonly (Exchange | Error)[]): ProbeAnswer {
  return (_request, index) => {
    const answer = answers[Math.min(index, answers.length - 1)]
    if (answer === undefined) {
      throw new TypeError('inOrder needs at least one answer')
    }
    return answer
  }
}

export function exchange(
  status: number,
  body: string | Uint8Array = '',
  headers: readonly HeaderPair[] = [],
): Exchange {
  return toExchange(response(status, body, headers), false)
}

/** `value` serialised compactly, with a JSON content type. */
export function jsonExchange(
  status: number,
  value: unknown,
  headers: readonly HeaderPair[] = [],
): Exchange {
  return exchange(status, JSON.stringify(value), [['Content-Type', 'application/json'], ...headers])
}

/** The JSON body a probe sent, for asserting on it. */
export function sentJson(request: ProbeRequest | undefined): unknown {
  if (request?.body === undefined || !('json' in request.body)) {
    return undefined
  }
  return request.body.json
}
