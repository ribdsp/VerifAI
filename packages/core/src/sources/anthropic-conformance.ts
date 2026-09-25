/**
 * Anthropic's own words for the Group A probes under
 * `probes/conformance/anthropic/`. The envelope and `request-id` sentences
 * more than one probe relies on stay in `anthropic.ts`; the per-model facts
 * - which model rejects which parameter - are `@verifai/fingerprints`'.
 *
 * Retrieved from https://platform.claude.com/docs/en/ with `.md` appended. A
 * quote is the page's markdown with link markup reduced to the link text, the
 * convention `@verifai/fingerprints` follows.
 */

import { citation } from './citation.js'

const RETRIEVED = '2026-09-24'
const DOCS = 'https://platform.claude.com/docs/en/'
const ERRORS = `${DOCS}api/errors`
const BETA_HEADERS = `${DOCS}api/beta-headers`
const MESSAGES = `${DOCS}api/messages/create`
const MODELS_RETRIEVE = `${DOCS}api/models/retrieve`
const MODEL_IDS = `${DOCS}about-claude/models/model-ids-and-versions`

export const ANTHROPIC_ERROR_400 = citation(
  ERRORS,
  '400 - `invalid_request_error`: There was an issue with the format or content of your request. This error type may also be used for other 4XX status codes not listed in this section.',
  RETRIEVED,
)

export const ANTHROPIC_ERROR_401 = citation(
  ERRORS,
  "401 - `authentication_error`: There's an issue with your API key (for example, it's malformed, revoked, or expired; see Key expiration).",
  RETRIEVED,
)

export const ANTHROPIC_ERROR_402 = citation(
  ERRORS,
  "402 - `billing_error`: There's an issue with your billing or payment information.",
  RETRIEVED,
)

export const ANTHROPIC_ERROR_403 = citation(
  ERRORS,
  '403 - `permission_error`: Your API key does not have permission to use the specified resource.',
  RETRIEVED,
)

export const ANTHROPIC_ERROR_404 = citation(
  ERRORS,
  '404 - `not_found_error`: The requested resource was not found. Check the endpoint path and any resource IDs in the request URL.',
  RETRIEVED,
)

export const ANTHROPIC_ERROR_409 = citation(
  ERRORS,
  '409 - `conflict_error`: The request conflicts with the current state of a resource.',
  RETRIEVED,
)

export const ANTHROPIC_ERROR_413 = citation(
  ERRORS,
  '413 - `request_too_large`: Request exceeds the maximum allowed number of bytes.',
  RETRIEVED,
)

export const ANTHROPIC_ERROR_429 = citation(
  ERRORS,
  "429 - `rate_limit_error`: Your organization has hit a rate limit, reached its usage tier's monthly spend cap, or reached a spend limit on the Claude Code workspace.",
  RETRIEVED,
)

export const ANTHROPIC_ERROR_500 = citation(
  ERRORS,
  "500 - `api_error`: An unexpected error has occurred internal to Anthropic's systems.",
  RETRIEVED,
)

export const ANTHROPIC_ERROR_504 = citation(
  ERRORS,
  '504 - `timeout_error`: The request timed out while processing.',
  RETRIEVED,
)

export const ANTHROPIC_ERROR_529 = citation(
  ERRORS,
  '529 - `overloaded_error`: The API is temporarily overloaded.',
  RETRIEVED,
)

export const ANTHROPIC_ERROR_TYPES_MAY_GROW = citation(
  ERRORS,
  'In accordance with the versioning policy, the values within these objects may expand, and it is possible that the `type` values will grow over time.',
  RETRIEVED,
)

export const ANTHROPIC_REQUEST_ID_IN_BODY = citation(
  ERRORS,
  'The same identifier appears as the `request_id` field in error response bodies.',
  RETRIEVED,
)

export const ANTHROPIC_EXTRA_INPUTS_STATUS = citation(
  ERRORS,
  'Sending `thinking.block_binding` without the `thinking-binding-controls-2026-08-01` beta header returns a 400 `invalid_request_error` whose message ends in:',
  RETRIEVED,
)

export const ANTHROPIC_EXTRA_INPUTS_MESSAGE = citation(
  ERRORS,
  'block_binding: Extra inputs are not permitted',
  RETRIEVED,
)

export const ANTHROPIC_BETA_INVALID = citation(
  BETA_HEADERS,
  "If you use an invalid beta name, or a beta your organization doesn't have access to, you'll receive a `400` error response:",
  RETRIEVED,
)

export const ANTHROPIC_BETA_INVALID_MESSAGE = citation(
  BETA_HEADERS,
  'Unexpected value(s) `invalid-beta-name` for the `anthropic-beta` header. Please consult our documentation at platform.claude.com/docs or try again without the header.',
  RETRIEVED,
)

export const ANTHROPIC_BETA_NAME_PATTERN = citation(
  BETA_HEADERS,
  'Beta feature names typically follow the pattern `feature-name-YYYY-MM-DD`, where the date indicates when the beta was released.',
  RETRIEVED,
)

/** The reference marks every optional body parameter `optional`; `max_tokens` is not marked. */
export const ANTHROPIC_MAX_TOKENS_PARAMETER = citation(MESSAGES, '`max_tokens: number`', RETRIEVED)

export const ANTHROPIC_OPTIONAL_PARAMETER = citation(
  MESSAGES,
  '`metadata: optional Metadata`',
  RETRIEVED,
)

export const ANTHROPIC_MODELS_RESOLVE_ALIAS = citation(
  MODELS_RETRIEVE,
  'The Models API response can be used to determine information about a specific model or resolve a model alias to a model ID.',
  RETRIEVED,
)

export const ANTHROPIC_MODEL_OBJECT_TYPE = citation(
  MODELS_RETRIEVE,
  'For Models, this is always `"model"`.',
  RETRIEVED,
)

export const ANTHROPIC_MODEL_CAPABILITIES = citation(
  MODELS_RETRIEVE,
  '`capabilities: ModelCapabilities or null`',
  RETRIEVED,
)

export const ANTHROPIC_MODEL_CREATED_AT = citation(
  MODELS_RETRIEVE,
  'RFC 3339 datetime string representing the time at which the model was released. May be set to an epoch value if the release date is unknown.',
  RETRIEVED,
)

export const ANTHROPIC_MODEL_DISPLAY_NAME = citation(
  MODELS_RETRIEVE,
  'A human-readable name for the model.',
  RETRIEVED,
)

export const ANTHROPIC_MODEL_MAX_INPUT_TOKENS = citation(
  MODELS_RETRIEVE,
  '`max_input_tokens: number or null`',
  RETRIEVED,
)

export const ANTHROPIC_MODEL_MAX_TOKENS = citation(
  MODELS_RETRIEVE,
  '`max_tokens: number or null`',
  RETRIEVED,
)

export const ANTHROPIC_BEDROCK_MODEL_IDS = citation(
  MODEL_IDS,
  'For example: `anthropic.claude-sonnet-4-6`, `anthropic.claude-sonnet-5`, `anthropic.claude-opus-4-7`, `anthropic.claude-opus-4-8`, `anthropic.claude-opus-5`',
  RETRIEVED,
)

export const ANTHROPIC_VERTEX_DATED_IDS = citation(
  MODEL_IDS,
  'On Google Cloud, the date is separated with `@`:',
  RETRIEVED,
)
