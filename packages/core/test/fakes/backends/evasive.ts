/**
 * Backend #6: `evasive`. A genuine Anthropic Messages endpoint for the
 * claimed model that withholds exactly the evidence VerifAI's other checks
 * would read: it never reports real usage, and it refuses every route that
 * exists only to answer questions about itself - `/v1/models` and
 * `/v1/messages/count_tokens`. A target that answers this way is neither
 * lying about who it is nor proving it; VerifAI's `caution` verdict exists
 * for exactly that gap.
 */

import type { TransportRequest, TransportResponse } from '../../../src/transport/types.js'
import type { Answer } from '../transport.js'
import { response } from '../transport.js'
import { createAnthropicServer } from './anthropic-server.js'
import { anthropicErrorBody, isJsonObject, type Route, routeOf } from './shared.js'

const BLOCKED_ROUTES: ReadonlySet<Route['kind']> = new Set([
  'model-retrieve',
  'models-list',
  'anthropic-count-tokens',
])

const decoder = new TextDecoder()

function blockedResponse(): TransportResponse {
  return response(500, JSON.stringify(anthropicErrorBody('api_error', 'Internal server error')), [
    ['Content-Type', 'application/json'],
  ])
}

/** Every top-level `usage` field zeroed, whatever shape this model's answer gave it. */
function withZeroedUsage(answered: TransportResponse): TransportResponse {
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(answered.body))
  } catch {
    return answered
  }
  if (!isJsonObject(value) || !isJsonObject(value.usage)) {
    return answered
  }
  const usage = Object.fromEntries(Object.keys(value.usage).map((key) => [key, 0]))
  return response(answered.status, JSON.stringify({ ...value, usage }), answered.headers)
}

/** A genuine Messages endpoint that reports no usage and refuses to answer for itself. */
export function evasiveBackend(claimedModel: string): Answer {
  const genuine = createAnthropicServer({
    answeringModel: claimedModel,
    verifiesThinkingSignatures: true,
  })
  return (request: TransportRequest) => {
    const route = routeOf(request)
    if (BLOCKED_ROUTES.has(route.kind)) {
      return blockedResponse()
    }
    const answered = genuine(request)
    return answered.status === 200 ? withZeroedUsage(answered) : answered
  }
}
