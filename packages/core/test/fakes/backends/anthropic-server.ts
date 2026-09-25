/**
 * The Transport-level shell around `anthropic-request.ts`: turns a raw
 * `TransportRequest` into the route it names, the way a real Anthropic
 * endpoint would - malformed bodies, an unrecognised `anthropic-beta` header,
 * and `/v1/models/*` lookups all get answered before a Messages body ever
 * reaches the pure decision logic.
 */

import { anthropicModel } from '@verifai/fingerprints'
import type { TransportRequest, TransportResponse } from '../../../src/transport/types.js'
import { response } from '../transport.js'
import {
  type AnthropicServerConfig,
  answerAnthropicMessages,
  countAnthropicTokens,
} from './anthropic-request.js'
import { createAnthropicState } from './anthropic-state.js'
import { anthropicFactsFor } from './model-facts.js'
import { anthropicErrorBody, header, type JsonObject, parseBody, routeOf } from './shared.js'

export interface AnthropicServerOptions extends AnthropicServerConfig {
  /** The model this backend truly is, independent of whatever the request claims. */
  readonly answeringModel: string
}

type Answer = (request: TransportRequest) => TransportResponse

const BETA_HEADER_TEMPLATE = (name: string): string =>
  `Unexpected value(s) \`${name}\` for the \`anthropic-beta\` header. ` +
  'Please consult our documentation at platform.claude.com/docs or try again without the header.'

let requestIdCounter = 0

function requestId(): string {
  requestIdCounter += 1
  return `req_${requestIdCounter.toString(36).padStart(24, '0')}`
}

function jsonResponseWithId(status: number, body: JsonObject): TransportResponse {
  return response(status, JSON.stringify(body), [
    ['Content-Type', 'application/json'],
    ['request-id', requestId()],
  ])
}

/** Anthropic's error envelope always carries `request_id` in the body too, matching the header. */
function errorResponse(status: number, errorType: string, message: string): TransportResponse {
  const id = requestId()
  // biome-ignore lint/style/useNamingConvention: wire format
  const body = { ...anthropicErrorBody(errorType, message), request_id: id }
  return response(status, JSON.stringify(body), [
    ['Content-Type', 'application/json'],
    ['request-id', id],
  ])
}

/** Anthropic's RFC3339 model-created-at stamp; the exact instant is never checked, only its shape. */
const FIXED_CREATED_AT = '2026-01-01T00:00:00Z'

function modelResponse(id: string): TransportResponse {
  const model = anthropicModel(id)
  if (model === undefined) {
    return errorResponse(404, 'not_found_error', `model: ${id} not found`)
  }
  // biome-ignore-start lint/style/useNamingConvention: wire format
  return jsonResponseWithId(200, {
    type: 'model',
    id: model.id,
    display_name: model.displayName,
    created_at: FIXED_CREATED_AT,
    capabilities: null,
    max_input_tokens: model.contextWindowTokens?.value ?? null,
    max_tokens: model.maxOutputTokens?.value ?? null,
  })
  // biome-ignore-end lint/style/useNamingConvention: wire format
}

function betaHeaderRejection(request: TransportRequest): TransportResponse | undefined {
  const beta = header(request, 'anthropic-beta')
  return beta === undefined
    ? undefined
    : errorResponse(400, 'invalid_request_error', BETA_HEADER_TEMPLATE(beta))
}

/** A stand-in for a genuine Anthropic Messages endpoint, answering as `options.answeringModel`. */
export function createAnthropicServer(options: AnthropicServerOptions): Answer {
  const facts = anthropicFactsFor(options.answeringModel)
  const config: AnthropicServerConfig = {
    verifiesThinkingSignatures: options.verifiesThinkingSignatures,
  }
  const state = createAnthropicState()

  return (request: TransportRequest): TransportResponse => {
    const route = routeOf(request)
    if (route.kind === 'model-retrieve') {
      return modelResponse(route.modelId)
    }
    if (route.kind === 'models-list') {
      // biome-ignore lint/style/useNamingConvention: wire format
      return jsonResponseWithId(200, { data: [], has_more: false })
    }
    if (route.kind !== 'anthropic-messages' && route.kind !== 'anthropic-count-tokens') {
      return errorResponse(404, 'not_found_error', 'Not found')
    }
    const betaRejection = betaHeaderRejection(request)
    if (betaRejection !== undefined) {
      return betaRejection
    }
    const parsed = parseBody(request)
    if (parsed.kind !== 'json') {
      return errorResponse(400, 'invalid_request_error', 'Could not parse the request body as JSON')
    }
    if (route.kind === 'anthropic-count-tokens') {
      return jsonResponseWithId(200, countAnthropicTokens(parsed.value))
    }
    const answer = answerAnthropicMessages(parsed.value, facts, config, state)
    return jsonResponseWithId(answer.status, answer.body)
  }
}
