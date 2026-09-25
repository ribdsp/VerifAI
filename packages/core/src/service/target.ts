/**
 * From what the buyer typed to the target a check probes.
 *
 * Every refusal here is a fixed message naming the field and the problem,
 * never the value: the endpoint may carry a token in its path, and the key is
 * the key. The protocol is taken from the buyer, then from the URL they pasted,
 * and only then detected - detection costs three requests, which every
 * documented server rejects before inference.
 */

import { adapterFor } from '../adapters/adapter.js'
import { documentedModelName } from '../adapters/claim.js'
import { detectProtocol } from '../adapters/detect.js'
import { type Endpoint, type EndpointProblem, parseEndpoint } from '../adapters/endpoint.js'
import { inferVendor, type ModelIdProblem, normaliseModelId } from '../adapters/model.js'
import type { AuthScheme } from '../adapters/types.js'
import { type ApiKeyProblem, normaliseApiKey } from '../credentials/api-key.js'
import { parseTargetUrl } from '../net/target-url.js'
import type { ProbeTarget } from '../probes/types.js'
import type { Transport } from '../transport/types.js'
import { type Protocol, pairingOf, type Vendor } from '../types/target.js'
import type { ApiError, CheckRequest, EstimateWarning } from './contract.js'

const ENDPOINT_MESSAGES: Readonly<Record<EndpointProblem, string>> = Object.freeze({
  'not-a-url': 'endpoint: expected an http or https URL',
  'too-long': 'endpoint: longer than any API base URL',
  'unsupported-scheme': 'endpoint: expected an http or https URL',
  'embedded-credentials':
    'endpoint: must not carry a user name or password - the key has its own field',
  'query-string': 'endpoint: must not carry a query string',
})

const MODEL_MESSAGES: Readonly<Record<ModelIdProblem, string>> = Object.freeze({
  empty: 'model: expected the model name you were sold',
  'too-long': 'model: longer than any model name',
  'forbidden-character': 'model: contains control or invisible characters',
})

const KEY_MESSAGES: Readonly<Record<ApiKeyProblem, string>> = Object.freeze({
  empty: 'apiKey: empty',
  'too-short': 'apiKey: too short to be a key - check the paste',
  'too-long': 'apiKey: too long to be a key - check the paste',
  'invalid-character': 'apiKey: contains characters no API key has - check the paste',
})

export const BLOCKED_TARGET_MESSAGE =
  'VerifAI will not connect to this endpoint address. For an endpoint on your own network, allow private targets for this run.'

const UNREACHABLE_MESSAGE = 'No request reached the endpoint. Check the URL and your network.'

const DETECTION_FAILED_MESSAGE =
  'Could not tell which protocol the endpoint speaks. Choose one: anthropic-messages, openai-chat or openai-responses.'

const UNKNOWN_VENDOR_MESSAGE =
  'vendor: the model name names neither Claude nor GPT - choose anthropic or openai'

export interface ResolvedTarget {
  readonly target: ProbeTarget
  readonly apiKey: string | undefined
  readonly warnings: readonly EstimateWarning[]
}

export type Resolution =
  | { readonly ok: true; readonly value: ResolvedTarget }
  | { readonly ok: false; readonly error: ApiError }

function refuse(code: ApiError['code'], message: string): Resolution {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
}

interface Fields {
  readonly endpoint: Endpoint
  readonly model: string
  readonly apiKey: string | undefined
}

/** A blank key is no key: the buyer left the field empty. */
function keyOf(
  input: string | undefined,
): { key: string | undefined } | { problem: ApiKeyProblem } {
  if (input === undefined || input.trim() === '') {
    return { key: undefined }
  }
  const result = normaliseApiKey(input)
  return result.ok ? { key: result.key } : { problem: result.problem }
}

function fieldsOf(request: CheckRequest): Fields | Resolution {
  const endpoint = parseEndpoint(request.endpoint)
  if (!endpoint.ok) {
    return refuse('invalid-endpoint', ENDPOINT_MESSAGES[endpoint.problem])
  }
  const model = normaliseModelId(request.model)
  if (!model.ok) {
    return refuse('invalid-model', MODEL_MESSAGES[model.problem])
  }
  const key = keyOf(request.apiKey)
  if ('problem' in key) {
    return refuse('invalid-api-key', KEY_MESSAGES[key.problem])
  }
  return { endpoint: endpoint.endpoint, model: model.modelId, apiKey: key.key }
}

/** The scheme the buyer chose, or `undefined` for each protocol's own. */
function chosenAuth(request: CheckRequest): AuthScheme | undefined {
  return request.auth === undefined || request.auth === 'auto' ? undefined : request.auth
}

/** Refused when the buyer chose a scheme the protocol's vendor does not document. */
function authOf(
  request: CheckRequest,
  protocol: Protocol,
): { readonly auth: AuthScheme | undefined } | Resolution {
  const auth = chosenAuth(request)
  const { authSchemes } = adapterFor(protocol)
  if (auth === undefined || authSchemes.includes(auth)) {
    return { auth }
  }
  return refuse('invalid-request', `auth: ${protocol} takes only ${authSchemes.join(' or ')}`)
}

type Detected = { readonly protocol: Protocol; readonly detected: boolean } | Resolution

async function protocolOf(
  request: CheckRequest,
  fields: Fields,
  transport: Transport,
  signal: AbortSignal | undefined,
): Promise<Detected> {
  if (request.protocol !== 'auto') {
    return { protocol: request.protocol, detected: false }
  }
  if (fields.endpoint.protocolHint !== undefined) {
    return { protocol: fields.endpoint.protocolHint, detected: false }
  }
  const auth = chosenAuth(request)
  const detection = await detectProtocol({
    transport,
    endpoint: fields.endpoint,
    claimedModel: fields.model,
    ...(fields.apiKey === undefined ? {} : { apiKey: fields.apiKey }),
    ...(auth === undefined ? {} : { auth }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (detection.protocol !== undefined) {
    return { protocol: detection.protocol, detected: true }
  }
  const failures = detection.attempts.flatMap(({ outcome }) =>
    outcome.kind === 'failed' ? [outcome.failure] : [],
  )
  if (failures.includes('blocked-target')) {
    return refuse('blocked-target', BLOCKED_TARGET_MESSAGE)
  }
  if (failures.length === detection.attempts.length) {
    return refuse('unreachable', UNREACHABLE_MESSAGE)
  }
  return refuse('detection-failed', DETECTION_FAILED_MESSAGE)
}

function warningsOf(
  request: CheckRequest,
  resolved: { endpoint: Endpoint; apiKey: string | undefined; target: ProbeTarget },
  detected: boolean,
): EstimateWarning[] {
  const conditions: readonly (readonly [EstimateWarning, boolean])[] = [
    ['plain-http', resolved.endpoint.root.startsWith('http:')],
    ['cross-protocol', resolved.target.pairing === 'cross-protocol'],
    ['no-api-key', resolved.apiKey === undefined],
    ['private-targets-allowed', request.allowPrivateTargets === true],
    ['protocol-detected', detected],
    ['model-mapped', resolved.target.claimedModel !== resolved.target.requestedModel],
    ['vendor-inferred', request.vendor === 'auto'],
  ]
  return conditions.flatMap(([warning, holds]) => (holds ? [warning] : []))
}

interface Claim {
  readonly model: string
  readonly vendor: Vendor | undefined
}

/**
 * The documented model the typed name stands for, and its vendor. A chosen
 * vendor narrows the lookup to its own catalog; an inferred one is read from
 * the documented name first, which a gateway's decoration cannot confuse.
 */
function claimOf(request: CheckRequest, typed: string): Claim {
  if (request.vendor !== 'auto') {
    return { model: documentedModelName(typed, request.vendor), vendor: request.vendor }
  }
  const model = documentedModelName(typed)
  return { model, vendor: inferVendor(model) ?? inferVendor(typed) }
}

/**
 * Validates the request, settles vendor and protocol, and builds the target.
 * Resolves for every refusal; rejects only for a transport that does.
 */
export async function resolveTarget(
  request: CheckRequest,
  transport: Transport,
  signal?: AbortSignal,
): Promise<Resolution> {
  const fields = fieldsOf(request)
  if ('ok' in fields) {
    return fields
  }
  const policy = { allowPrivateTargets: request.allowPrivateTargets === true }
  const address = parseTargetUrl(fields.endpoint.root, policy)
  if (!address.ok && address.problem === 'blocked-address') {
    return refuse('blocked-target', BLOCKED_TARGET_MESSAGE)
  }
  const claimed = claimOf(request, fields.model)
  const vendor = claimed.vendor
  if (vendor === undefined) {
    return refuse('invalid-request', UNKNOWN_VENDOR_MESSAGE)
  }
  const detected = await protocolOf(request, fields, transport, signal)
  if ('ok' in detected) {
    return detected
  }
  const scheme = authOf(request, detected.protocol)
  if ('ok' in scheme) {
    return scheme
  }
  const target: ProbeTarget = Object.freeze({
    endpoint: fields.endpoint,
    protocol: detected.protocol,
    claimedVendor: vendor,
    claimedModel: claimed.model,
    requestedModel: fields.model,
    pairing: pairingOf(detected.protocol, vendor),
    ...(scheme.auth === undefined ? {} : { auth: scheme.auth }),
  })
  const warnings = warningsOf(request, { ...fields, target }, detected.detected)
  return Object.freeze({
    ok: true,
    value: Object.freeze({ target, apiKey: fields.apiKey, warnings: Object.freeze(warnings) }),
  })
}
