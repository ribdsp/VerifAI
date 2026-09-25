/**
 * The API root a buyer's endpoint URL names, and the operation URLs under it.
 *
 * Buyers paste whatever their reseller's dashboard shows: a bare host, a base
 * URL ending in `/v1`, or the full URL of one operation. The two vendors' SDKs
 * disagree on what a base URL is - OpenAI's includes `/v1`, Anthropic's does
 * not - so every form is reduced to one API root that ends at the version
 * segment, and operations are joined under it.
 *
 * A pasted operation URL is taken at its word: whatever precedes the operation
 * is the root, version segment or not. That is the escape hatch for gateways
 * that mount the API somewhere unusual (`/v1beta/openai/chat/completions`), and
 * it names a protocol, which detection tries first.
 *
 * This is structure only. Whether the host may be contacted is the transport's
 * question, asked against every address it resolves to at send time.
 */

import type { Protocol } from '../types/target.js'
import { type Member, vocabulary } from '../types/vocabulary.js'

export const ENDPOINT_PROBLEMS = vocabulary([
  'not-a-url',
  'too-long',
  'unsupported-scheme',
  'embedded-credentials',
  'query-string',
])
export type EndpointProblem = Member<typeof ENDPOINT_PROBLEMS>

export interface Endpoint {
  /** Origin and path through the version segment, with no trailing slash. */
  readonly root: string
  /** The protocol whose operation the pasted URL ended in, if it ended in one. */
  readonly protocolHint: Protocol | undefined
}

export type EndpointResult =
  | { readonly ok: true; readonly endpoint: Endpoint }
  | { readonly ok: false; readonly problem: EndpointProblem }

/** Far past any real base URL; past this the paste was something else. */
export const MAX_ENDPOINT_LENGTH = 2048

/**
 * Operations a pasted URL may end in. Longest first, so `messages/count_tokens`
 * is recognised before `messages` could claim its first segment.
 */
const OPERATIONS: readonly (readonly [segments: readonly string[], hint: Protocol | undefined])[] =
  [
    [['messages', 'count_tokens'], 'anthropic-messages'],
    [['chat', 'completions'], 'openai-chat'],
    [['messages'], 'anthropic-messages'],
    [['responses'], 'openai-responses'],
    [['models'], undefined],
  ]

/** `v1`, `v2`, `v1beta`, `v1alpha2`. Case-sensitive, as paths are. */
const VERSION_SEGMENT = /^v\d+(?:(?:alpha|beta)\d*)?$/
const DEFAULT_VERSION = 'v1'

const SUPPORTED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

const REFUSALS: ReadonlyMap<EndpointProblem, EndpointResult> = new Map(
  ENDPOINT_PROBLEMS.values.map((problem) => [problem, Object.freeze({ ok: false, problem })]),
)

function refuse(problem: EndpointProblem): EndpointResult {
  const refusal = REFUSALS.get(problem)
  if (refusal === undefined) {
    throw new Error(`No refusal for endpoint problem ${problem}`)
  }
  return refusal
}

function parse(input: string): URL | undefined {
  try {
    return new URL(input)
  } catch {
    // The only thing `URL` says is "Invalid URL"; `not-a-url` is the same fact.
    return undefined
  }
}

function endsWith(segments: readonly string[], suffix: readonly string[]): boolean {
  const offset = segments.length - suffix.length
  return offset >= 0 && suffix.every((segment, at) => segments[offset + at] === segment)
}

/** Path segments without the trailing empties a trailing slash produces. */
function pathSegments(pathname: string): string[] {
  const segments = pathname.split('/').slice(1)
  while (segments.length > 0 && segments.at(-1) === '') {
    segments.pop()
  }
  return segments
}

export function parseEndpoint(input: string): EndpointResult {
  const trimmed = input.trim()
  if (trimmed.length > MAX_ENDPOINT_LENGTH) {
    return refuse('too-long')
  }
  const url = parse(trimmed)
  if (url === undefined) {
    return refuse('not-a-url')
  }
  // http and https are special schemes, so a URL that parsed has a host.
  if (!SUPPORTED_SCHEMES.has(url.protocol)) {
    return refuse('unsupported-scheme')
  }
  // A key in the URL would land in every log line and report that shows the
  // endpoint. Keys have their own channel: an environment variable or a prompt.
  if (url.username !== '' || url.password !== '') {
    return refuse('embedded-credentials')
  }
  // Joining an operation onto a URL with a query has no single right answer,
  // and query strings are where gateways that do not take headers put keys.
  if (url.search !== '') {
    return refuse('query-string')
  }

  const segments = pathSegments(url.pathname)
  const operation = OPERATIONS.find(([suffix]) => endsWith(segments, suffix))
  if (operation !== undefined) {
    segments.length -= operation[0].length
  } else if (!VERSION_SEGMENT.test(segments.at(-1) ?? '')) {
    segments.push(DEFAULT_VERSION)
  }

  const path = segments.length === 0 ? '' : `/${segments.join('/')}`
  const endpoint: Endpoint = Object.freeze({
    root: `${url.origin}${path}`,
    protocolHint: operation?.[1],
  })
  return Object.freeze({ ok: true, endpoint })
}

/** `path` is one of the adapters' own operation paths, never user input. */
export function operationUrl(endpoint: Endpoint, path: string): string {
  return `${endpoint.root}/${path}`
}

/**
 * The retrieve-model operation. The id is user input and becomes exactly one
 * path segment: a `/`, `?` or `#` in it is encoded, never interpreted.
 *
 * @throws TypeError for `''`, `.` and `..`, which a URL parser would resolve
 * to the collection or its parent instead of a model.
 */
export function modelPath(modelId: string): string {
  if (modelId === '' || modelId === '.' || modelId === '..') {
    throw new TypeError('A model id must name a model, not a path')
  }
  return `models/${encodeURIComponent(modelId)}`
}
