/**
 * Backend #5: `fractional-router`. Most requests are truly answered by the
 * claimed model; a fixed fraction of the traffic - independent of what any
 * single request asks - is answered by a cheaper model instead, the way a
 * cost-saving router in front of a real deployment might divert some share
 * of calls without regard to their content. No request is inspected to
 * decide whether to divert it: the decision is a coin flip against a fixed
 * rate, advanced once per request.
 */

import type { Answer } from '../transport.js'
import { createAnthropicServer } from './anthropic-server.js'

export interface FractionalRouterOptions {
  readonly claimedModel: string
  readonly cheaperModel: string
  /** The fraction of requests answered by `cheaperModel` instead of `claimedModel`. */
  readonly epsilon: number
  /** A `[0, 1)` generator; defaults to a fixed-seed PRNG so runs reproduce. */
  readonly random?: () => number
}

const DEFAULT_SEED = 0x5eed1e5

/** mulberry32: small, seeded, and good enough for a Bernoulli trial per request. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** A fixed fraction of traffic quietly answered by a cheaper model instead of the claimed one. */
export function fractionalRouterBackend(options: FractionalRouterOptions): Answer {
  const claimed = createAnthropicServer({
    answeringModel: options.claimedModel,
    verifiesThinkingSignatures: true,
  })
  const cheaper = createAnthropicServer({
    answeringModel: options.cheaperModel,
    verifiesThinkingSignatures: true,
  })
  const random = options.random ?? mulberry32(DEFAULT_SEED)
  return (request) => (random() < options.epsilon ? cheaper : claimed)(request)
}
