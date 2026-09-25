/**
 * What the OpenAI conformance probes share: the no-key requests more than one
 * of them reads, sent once per run, readers for how OpenAI's edge lays out and
 * words what it answers, and the rejection-matrix readings bound to OpenAI's
 * docs.
 *
 * The edge probes compare against facts that were observed, not documented -
 * see `sources/measured-conformance.ts` - so every signal they build is
 * `heuristic`, and no mismatch there moves `identity`: a reseller that checks
 * keys itself, or a gateway that translates, answers these requests in its own
 * words while serving the claimed model faithfully. The rejection matrix is the
 * exception: it reads what OpenAI documents model by model, and `../shared.ts`
 * explains why that may speak on `identity`.
 */

import { cheaperOpenaiModels, type OpenAIModel, openaiModel } from '@verifai/fingerprints'
import type { ErrorBody } from '../../../adapters/error-body.js'
import type { Citation } from '../../../sources/citation.js'
import { OPENAI_INVALID_REQUEST_ERROR } from '../../../sources/openai-conformance.js'
import type { Protocol } from '../../../types/target.js'
import { errorOf, jsonOf, quoted, signal } from '../../shared.js'
import type { Exchange, ProbeContext, ProbeRequest, Signal } from '../../types.js'
import { type RejectionCell as MatrixRejectionCell, rejectionMatrix } from '../shared.js'

export const OPENAI_PROTOCOLS: readonly Protocol[] = Object.freeze([
  'openai-chat',
  'openai-responses',
])

/** The four routes whose no-key 401s OpenAI serializes differently. */
export type NoKeyRoute =
  | 'get-models'
  | 'get-chat-completions'
  | 'post-chat-completions'
  | 'post-responses'

export const NO_KEY_ROUTES: readonly NoKeyRoute[] = Object.freeze([
  'get-models',
  'get-chat-completions',
  'post-chat-completions',
  'post-responses',
])

interface RouteRequest {
  readonly method: 'GET' | 'POST'
  readonly path: string
}

const ROUTE_REQUESTS: Readonly<Record<NoKeyRoute, RouteRequest>> = Object.freeze({
  'get-models': { method: 'GET', path: 'models' },
  'get-chat-completions': { method: 'GET', path: 'chat/completions' },
  'post-chat-completions': { method: 'POST', path: 'chat/completions' },
  'post-responses': { method: 'POST', path: 'responses' },
})

/** `GET models`, for a report line. */
export function routeLabel(route: NoKeyRoute): string {
  const { method, path } = ROUTE_REQUESTS[route]
  return `${method} ${path}`
}

/**
 * `route` asked without a credential. A POST carries `{}`: OpenAI checks the
 * key before it reads the body, so the body only has to be JSON.
 */
export function noKeyExchange(context: ProbeContext, route: NoKeyRoute): Promise<Exchange> {
  const { method, path } = ROUTE_REQUESTS[route]
  const request: ProbeRequest = {
    path,
    method,
    credential: 'none',
    provokes: [401],
    ...(method === 'POST' ? { body: { json: {} } } : {}),
  }
  return context.shared(`conformance/openai/no-key/${route}`, () => context.send(request))
}

/** A path no OpenAI deployment routes, asked without a credential. */
export function notFoundExchange(context: ProbeContext): Promise<Exchange> {
  return context.shared('conformance/openai/not-found', () =>
    context.send({
      path: `nonexistent-${context.nonce}`,
      method: 'GET',
      credential: 'none',
      provokes: [404],
    }),
  )
}

export type Layout = 'compact' | 'indent-2' | 'indent-4' | 'other'

const INDENTS: Readonly<Record<number, Layout>> = Object.freeze({ 2: 'indent-2', 4: 'indent-4' })

/**
 * How a JSON body is laid out: compact, or pretty-printed at the indent of its
 * first member. `undefined` when the body is not JSON.
 */
export function layoutOf(exchange: Exchange): Layout | undefined {
  const value = jsonOf(exchange)
  const text = exchange.text?.trim()
  if (value === undefined || text === undefined) {
    return undefined
  }
  if (text === JSON.stringify(value)) {
    return 'compact'
  }
  const indent = /^\{\r?\n( +)"/.exec(text)?.[1]?.length
  return (indent === undefined ? undefined : INDENTS[indent]) ?? 'other'
}

/** The body as an error in OpenAI's envelope, or `undefined`. */
export function openaiError(exchange: Exchange): ErrorBody | undefined {
  const error = errorOf(exchange)
  return error?.dialect === 'openai' ? error : undefined
}

/** `status 400, code "x": "message"`, for `observed`. */
export function describeError(exchange: Exchange): string {
  const error = openaiError(exchange)
  if (error === undefined) {
    return `status ${exchange.status}, no error in OpenAI's envelope`
  }
  const code = error.code === undefined ? 'no code' : `code ${JSON.stringify(error.code)}`
  return `status ${exchange.status}, ${code}: ${quoted(error.message)}`
}

export type Finding = Omit<Signal, 'probeId' | 'family' | 'calibration' | 'citations'>

/** A signal resting on an observation of OpenAI's edge rather than on its documentation. */
export function observedSignal(probeId: string, source: Citation, finding: Finding): Signal {
  return signal({
    ...finding,
    probeId,
    family: 'protocol-conformance',
    calibration: 'heuristic',
    citations: [source],
  })
}

export type RejectionCell = MatrixRejectionCell<OpenAIModel>

const OPENAI_MATRIX = rejectionMatrix<OpenAIModel>({
  name: 'OpenAI',
  family: 'GPT',
  dialect: 'openai',
  model: openaiModel,
  cheaper: cheaperOpenaiModels,
  refusal: [OPENAI_INVALID_REQUEST_ERROR],
})

export const { documentsAny, runMatrix } = OPENAI_MATRIX
