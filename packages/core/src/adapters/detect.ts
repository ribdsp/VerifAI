/**
 * Which of the three protocols an endpoint answers, found by asking each once.
 *
 * Every attempt is the same request: `{}` posted to the protocol's generate
 * operation. It is invalid in all three - none accepts a request with no model
 * and no input - so a server that implements the operation refuses it in
 * validation, before anything is generated, and refuses it in some vendor's
 * error envelope. A route that does not exist answers 404 or 405. What a route
 * answers is evidence twice over: that it exists, and in whose dialect it fails.
 * Two answers are read as a route that exists although neither is a vendor's
 * validation error: a 404 that says the model was not found, since only a
 * route that exists looks a model up, and a platform that refuses `{}` in its
 * own JSON rather than a vendor's, as Snowflake Cortex does.
 *
 * Detection only chooses where later probes are sent. It judges nothing: a
 * Claude model served on `/v1/chat/completions` is a legitimate translation.
 * Every attempt keeps its transport result, so the probes that do judge can
 * read what detection already received instead of asking again.
 */

import { type JsonBody, readJsonBody } from '../transport/json-body.js'
import type {
  Transport,
  TransportFailureKind,
  TransportRequest,
  TransportResult,
} from '../transport/types.js'
import { PROTOCOLS, type Protocol, protocolOwner, type Vendor } from '../types/target.js'
import { adapterFor, authFor, buildRequest } from './adapter.js'
import type { Endpoint } from './endpoint.js'
import { type ErrorBody, type ErrorDialect, readErrorBody } from './error-body.js'
import { isJsonObject } from './json.js'
import { inferVendor } from './model.js'
import type { AuthScheme } from './types.js'

/** Validation errors come back at once; this only bounds an endpoint that hangs. */
export const DETECT_TIMEOUT_MS = 20_000

/** Far above any error envelope, far below a page that is not one. */
export const DETECT_MAX_RESPONSE_BYTES = 64 * 1024

export type AttemptOutcome =
  /** No HTTP response: the transport's failure kind says why. */
  | { readonly kind: 'failed'; readonly failure: TransportFailureKind }
  /** 404 or 405: the route is not there, unless the body says the model was not found. */
  | { readonly kind: 'absent'; readonly status: number }
  /**
   * Refused in a recognisable error envelope. `ownDialect` when the envelope is
   * that of the vendor who defines the protocol.
   */
  | {
      readonly kind: 'speaks'
      readonly status: number
      readonly dialect: ErrorDialect
      readonly ownDialect: boolean
    }
  /**
   * A success status for a request no documented server accepts. `readsAs` is
   * the protocol whose generation the body reads as, this one first.
   */
  | { readonly kind: 'accepted'; readonly status: number; readonly readsAs: Protocol | undefined }
  /** Refused in validation, in a JSON object that is neither vendor's envelope. */
  | { readonly kind: 'refuses'; readonly status: number }
  /** An answer that is none of the above, such as a gateway's HTML error page. */
  | { readonly kind: 'unclear'; readonly status: number; readonly body: JsonBody['kind'] }

export interface DetectionAttempt {
  readonly protocol: Protocol
  readonly outcome: AttemptOutcome
  readonly result: TransportResult
}

export interface Detection {
  /** One per protocol, in `PROTOCOLS` order. */
  readonly attempts: readonly DetectionAttempt[]
  /** The protocols that answered as a server of that protocol would, best first. */
  readonly ranked: readonly Protocol[]
  /** `ranked[0]`: where probes go unless the buyer names a protocol. */
  readonly protocol: Protocol | undefined
}

export interface DetectOptions {
  readonly transport: Transport
  readonly endpoint: Endpoint
  /**
   * Sent when given, so an endpoint that checks keys before it validates still
   * reaches validation.
   */
  readonly apiKey?: string
  /** How the key travels, to each protocol that takes it that way. */
  readonly auth?: AuthScheme
  /** The model the buyer was sold. Only a tie-break toward its vendor's protocols. */
  readonly claimedModel?: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

const ABSENT_STATUSES: ReadonlySet<number> = new Set([404, 405])

/** Where a platform that is no vendor refuses a request it cannot validate. */
const VALIDATION_STATUSES: ReadonlySet<number> = new Set([400, 422])

/** OpenAI's `error.code` for a model the route looked up and did not find. */
const MODEL_NOT_FOUND = 'model_not_found'

/**
 * An envelope in the protocol's own dialect is what its vendor's server
 * sends; a foreign one is a translation layer that still routes the
 * operation; a generation in answer to `{}` is a route that validates
 * nothing; a platform's own refusal says only that the route is there.
 */
const RANKS = Object.freeze({ ownDialect: 4, foreignDialect: 3, generation: 2, platform: 1 })

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

function readsAs(value: unknown, probed: Protocol): Protocol | undefined {
  const order = [probed, ...PROTOCOLS.values.filter((protocol) => protocol !== probed)]
  return order.find((protocol) => adapterFor(protocol).readGeneration(value) !== undefined)
}

function speaks(protocol: Protocol, status: number, error: ErrorBody): AttemptOutcome {
  return Object.freeze({
    kind: 'speaks',
    status,
    dialect: error.dialect,
    ownDialect: error.dialect === protocolOwner(protocol),
  })
}

function isModelNotFound(error: ErrorBody | undefined): error is ErrorBody {
  return error?.dialect === 'openai' && error.code === MODEL_NOT_FOUND
}

function classify(protocol: Protocol, result: TransportResult): AttemptOutcome {
  if (!result.ok) {
    return Object.freeze({ kind: 'failed', failure: result.kind })
  }
  const { status } = result
  const body = readJsonBody(result.body)
  const error = body.kind === 'json' ? readErrorBody(body.value) : undefined
  if (ABSENT_STATUSES.has(status)) {
    return isModelNotFound(error)
      ? speaks(protocol, status, error)
      : Object.freeze({ kind: 'absent', status })
  }
  if (body.kind !== 'json') {
    return Object.freeze({ kind: 'unclear', status, body: body.kind })
  }
  if (isSuccess(status)) {
    return Object.freeze({ kind: 'accepted', status, readsAs: readsAs(body.value, protocol) })
  }
  if (error !== undefined) {
    return speaks(protocol, status, error)
  }
  if (VALIDATION_STATUSES.has(status) && isJsonObject(body.value)) {
    return Object.freeze({ kind: 'refuses', status })
  }
  return Object.freeze({ kind: 'unclear', status, body: body.kind })
}

function rankOf({ protocol, outcome }: DetectionAttempt): number | undefined {
  if (outcome.kind === 'speaks') {
    return outcome.ownDialect ? RANKS.ownDialect : RANKS.foreignDialect
  }
  if (outcome.kind === 'accepted' && outcome.readsAs === protocol) {
    return RANKS.generation
  }
  if (outcome.kind === 'refuses') {
    return RANKS.platform
  }
  return undefined
}

interface Candidate {
  readonly protocol: Protocol
  readonly rank: number
  readonly hinted: boolean
  readonly native: boolean
  readonly order: number
}

/** Rank, then the protocol the pasted URL named, then the claimed vendor's, then `PROTOCOLS` order. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    b.rank - a.rank ||
    Number(b.hinted) - Number(a.hinted) ||
    Number(b.native) - Number(a.native) ||
    a.order - b.order
  )
}

function rankProtocols(
  attempts: readonly DetectionAttempt[],
  hint: Protocol | undefined,
  vendor: Vendor | undefined,
): readonly Protocol[] {
  const candidates = attempts.flatMap((attempt, order): Candidate[] => {
    const rank = rankOf(attempt)
    if (rank === undefined) {
      return []
    }
    const { protocol } = attempt
    return [
      {
        protocol,
        rank,
        hinted: protocol === hint,
        native: protocolOwner(protocol) === vendor,
        order,
      },
    ]
  })
  return Object.freeze(candidates.toSorted(compareCandidates).map(({ protocol }) => protocol))
}

/**
 * @throws TypeError for a key that cannot be sent, before any request is. Every
 * network outcome resolves; a transport that rejects is passed on, since that
 * is a bug rather than a property of the endpoint.
 */
export async function detectProtocol(options: DetectOptions): Promise<Detection> {
  // Built together before anything is sent, so a refused key refuses all three.
  const requests = PROTOCOLS.values.map((protocol): readonly [Protocol, TransportRequest] => {
    const adapter = adapterFor(protocol)
    const request = buildRequest(adapter, {
      endpoint: options.endpoint,
      path: adapter.generatePath,
      body: { json: {} },
      timeoutMs: options.timeoutMs ?? DETECT_TIMEOUT_MS,
      maxResponseBytes: DETECT_MAX_RESPONSE_BYTES,
      auth: authFor(adapter, options.auth),
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    return [protocol, request]
  })

  const attempts = await Promise.all(
    requests.map(async ([protocol, request]): Promise<DetectionAttempt> => {
      const result = await options.transport.send(request)
      return Object.freeze({ protocol, outcome: classify(protocol, result), result })
    }),
  )

  const vendor = options.claimedModel === undefined ? undefined : inferVendor(options.claimedModel)
  const ranked = rankProtocols(attempts, options.endpoint.protocolHint, vendor)
  return Object.freeze({ attempts: Object.freeze(attempts), ranked, protocol: ranked[0] })
}
