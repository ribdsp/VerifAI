/**
 * The Transport-level shell around `openai-core.ts`: turns a raw
 * `TransportRequest` into the route it names, the way a real OpenAI endpoint
 * would - each unauthenticated route's own wording and body layout, a CORS
 * preflight on Chat Completions, the Cloudflare-fronted headers a routed
 * request carries that a bare 404 does not, and a wholly empty body for
 * anything unrouted or wrong-methoded - before a Chat Completions or
 * Responses body ever reaches the pure decision logic.
 */

import type {
  HeaderPair,
  TransportRequest,
  TransportResponse,
} from '../../../src/transport/types.js'
import { type Answer, response } from '../transport.js'
import { type OpenaiModelFacts, openaiFactsFor } from './model-facts.js'
import {
  answerOpenaiChat,
  answerOpenaiResponses,
  isKnownOpenaiModel,
  modelNotFoundBody,
} from './openai-core.js'
import {
  header,
  type JsonObject,
  openaiErrorBody,
  openaiRequestId,
  parseBody,
  routeOf,
} from './shared.js'

export interface OpenaiServerOptions {
  /** The model this backend truly is, independent of whatever the request claims. */
  readonly answeringModel: string
  /**
   * The `model` its answers and its model list report: a seller relabelling a
   * cheaper model reports the one it sells. The answering model's own ID by
   * default.
   */
  readonly reportedModel?: string
}

const PROXY_WASM_HEADER: HeaderPair = ['x-openai-proxy-wasm', 'v2']

/** Every routed response, success or error, passes through this stack; a bare 404 never does. */
function infraHeaders(extra: readonly HeaderPair[] = []): readonly HeaderPair[] {
  return [
    ['Content-Type', 'application/json'],
    PROXY_WASM_HEADER,
    ['x-request-id', openaiRequestId()],
    ...extra,
  ]
}

interface JsonAnswerOptions {
  readonly indent?: number
  readonly extraHeaders?: readonly HeaderPair[]
}

function jsonAnswer(
  status: number,
  body: JsonObject,
  options: JsonAnswerOptions = {},
): TransportResponse {
  const text =
    options.indent === undefined ? JSON.stringify(body) : JSON.stringify(body, null, options.indent)
  return response(status, text, infraHeaders(options.extraHeaders))
}

/** A wholly empty, headerless body: what an unrouted path or a wrong-methoded real route gets. */
function bareNotFound(): TransportResponse {
  return response(404)
}

const PREFLIGHT_HEADERS: readonly HeaderPair[] = [
  ['access-control-allow-methods', 'GET, OPTIONS, POST'],
  ['access-control-max-age', '86400'],
]

function preflight(): TransportResponse {
  return response(200, '', PREFLIGHT_HEADERS)
}

function authRejection(message: string, options: JsonAnswerOptions = {}): TransportResponse {
  return jsonAnswer(401, openaiErrorBody({ message, param: null, code: null }), options)
}

const BEARER_OR_BASIC = 'Missing bearer or basic authentication in header'
const BEARER_ONLY = 'Missing bearer authentication in header'
const LEGACY_NO_KEY =
  "You didn't provide an API key. You need to provide your API key in an Authorization header " +
  'using Bearer auth (i.e. Authorization: Bearer YOUR_KEY), or as the password field (with blank ' +
  "username) if you're accessing the API from your browser and are prompted for a username and " +
  'password. You can obtain an API key from https://platform.openai.com/account/api-keys.'

/** `cf-ray` is echoed twice on this one route's own no-key rejection - documented, not a typo. */
const MODELS_EXPOSE_HEADERS: HeaderPair = ['access-control-expose-headers', 'cf-ray, cf-ray']

function noKeyModelsList(): TransportResponse {
  return authRejection(BEARER_ONLY, { indent: 2, extraHeaders: [MODELS_EXPOSE_HEADERS] })
}

function noKeyModelRetrieve(): TransportResponse {
  return authRejection(BEARER_ONLY, { indent: 2 })
}

function noKeyChatGet(): TransportResponse {
  return authRejection(BEARER_OR_BASIC)
}

function noKeyChatPost(): TransportResponse {
  return authRejection(LEGACY_NO_KEY, { indent: 4 })
}

function noKeyResponses(): TransportResponse {
  return authRejection(BEARER_OR_BASIC, { indent: 2 })
}

const FIXED_CREATED_AT = 1_800_000_000

// biome-ignore-start lint/style/useNamingConvention: wire format
function modelsListAnswer(reportedModel: string): TransportResponse {
  return jsonAnswer(200, {
    object: 'list',
    data: [{ id: reportedModel, object: 'model', created: FIXED_CREATED_AT, owned_by: 'openai' }],
  })
}

function modelRetrieveAnswer(modelId: string, facts: OpenaiModelFacts): TransportResponse {
  if (!isKnownOpenaiModel(modelId, facts)) {
    return jsonAnswer(404, modelNotFoundBody(modelId))
  }
  return jsonAnswer(200, {
    id: modelId,
    object: 'model',
    created: FIXED_CREATED_AT,
    owned_by: 'system',
  })
}
// biome-ignore-end lint/style/useNamingConvention: wire format

async function fromCoreAnswer(
  request: TransportRequest,
  answer: (body: JsonObject) => Promise<{ readonly status: number; readonly body: JsonObject }>,
): Promise<TransportResponse> {
  const parsed = parseBody(request)
  if (parsed.kind !== 'json') {
    return jsonAnswer(
      400,
      openaiErrorBody({ message: 'Invalid JSON payload received.', param: null, code: null }),
    )
  }
  const result = await answer(parsed.value)
  return jsonAnswer(result.status, result.body)
}

function modelsListRoute(
  method: string,
  hasKey: boolean,
  reportedModel: string,
): TransportResponse {
  if (method !== 'GET') {
    return bareNotFound()
  }
  return hasKey ? modelsListAnswer(reportedModel) : noKeyModelsList()
}

function modelRetrieveRoute(
  method: string,
  hasKey: boolean,
  modelId: string,
  facts: OpenaiModelFacts,
): TransportResponse {
  if (method !== 'GET') {
    return bareNotFound()
  }
  return hasKey ? modelRetrieveAnswer(modelId, facts) : noKeyModelRetrieve()
}

function chatRoute(
  request: TransportRequest,
  method: string,
  hasKey: boolean,
  facts: OpenaiModelFacts,
  reportedModel: string,
): TransportResponse | Promise<TransportResponse> {
  if (method === 'OPTIONS') {
    return preflight()
  }
  if (method === 'GET') {
    return noKeyChatGet()
  }
  if (!hasKey) {
    return noKeyChatPost()
  }
  return fromCoreAnswer(request, (body) => answerOpenaiChat(body, facts, reportedModel))
}

function responsesRoute(
  request: TransportRequest,
  method: string,
  hasKey: boolean,
  facts: OpenaiModelFacts,
  reportedModel: string,
): TransportResponse | Promise<TransportResponse> {
  if (method === 'GET' || !hasKey) {
    return noKeyResponses()
  }
  return fromCoreAnswer(request, (body) => answerOpenaiResponses(body, facts, reportedModel))
}

/** A stand-in for a genuine OpenAI endpoint, answering as `options.answeringModel`. */
export function createOpenaiServer(options: OpenaiServerOptions): Answer {
  const facts = openaiFactsFor(options.answeringModel)
  const reportedModel = options.reportedModel ?? facts.id

  return (request: TransportRequest): TransportResponse | Promise<TransportResponse> => {
    const route = routeOf(request)
    const method = request.method.toUpperCase()
    const hasKey = header(request, 'Authorization') !== undefined

    switch (route.kind) {
      case 'models-list':
        return modelsListRoute(method, hasKey, reportedModel)
      case 'model-retrieve':
        return modelRetrieveRoute(method, hasKey, route.modelId, facts)
      case 'openai-chat':
        return chatRoute(request, method, hasKey, facts, reportedModel)
      case 'openai-responses':
        return responsesRoute(request, method, hasKey, facts, reportedModel)
      default:
        // `anthropic-messages` / `anthropic-count-tokens` / `unroutable` never reach a server
        // claiming an OpenAI model.
        return bareNotFound()
    }
  }
}
