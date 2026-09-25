/**
 * OpenAI's own words for the conformance probes under
 * `probes/conformance/openai/` and `probes/conformance/common/`.
 *
 * Retrieved from https://developers.openai.com/ with `.md` appended.
 */

import { citation } from './citation.js'

const RETRIEVED = '2026-09-24'
const CHAT = 'https://developers.openai.com/api/reference/resources/chat'
const RESPONSES = 'https://developers.openai.com/api/reference/resources/responses/methods/create'

export const OPENAI_CHAT_TEMPERATURE_RANGE = citation(
  CHAT,
  'What sampling temperature to use, between 0 and 2.',
  RETRIEVED,
)

export const OPENAI_RESPONSES_TEMPERATURE_RANGE = citation(
  RESPONSES,
  'What sampling temperature to use, between 0 and 2.',
  RETRIEVED,
)

export const OPENAI_CHAT_COMPLETION_OBJECT = citation(
  CHAT,
  'The object type, which is always `chat.completion`.',
  RETRIEVED,
)

export const OPENAI_RESPONSE_OBJECT = citation(
  RESPONSES,
  'The object type of this resource - always set to `response`.',
  RETRIEVED,
)

export const OPENAI_SYSTEM_FINGERPRINT = citation(
  CHAT,
  'This fingerprint represents the backend configuration that the model runs with.',
  RETRIEVED,
)

/**
 * The error-codes guide gives one refusal with its `type`: a request shape the
 * API does not take comes back as a 400 `invalid_request_error`.
 */
export const OPENAI_INVALID_REQUEST_ERROR = citation(
  'https://developers.openai.com/api/docs/guides/error-codes',
  'The API returns the message "Invalid service_tier argument: The requested service tier is not allowed for this project." as an `invalid_request_error` with `error.param` set to `service_tier` when a request selects or resolves to a service tier that is not allowed for the project.',
  '2026-09-25',
)
