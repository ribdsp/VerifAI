/**
 * Anthropic's own words, for the behaviours more than one probe relies on.
 * A citation only one probe uses lives beside that probe's other sources, in
 * a file of its own under `sources/`.
 *
 * Retrieved from https://platform.claude.com/docs/en/ with `.md` appended,
 * which serves the page as markdown.
 */

import { citation } from './citation.js'

const RETRIEVED = '2026-09-24'

export const ANTHROPIC_ERROR_ENVELOPE = citation(
  'https://platform.claude.com/docs/en/api/errors',
  'The API always returns errors as JSON, with a top-level `error` object that always includes a `type` and `message` value. The response also includes a `request_id` field for easier tracking and debugging.',
  RETRIEVED,
)

export const ANTHROPIC_REQUEST_ID_HEADER = citation(
  'https://platform.claude.com/docs/en/api/errors',
  'Every API response includes a unique `request-id` header. This header contains a value such as `req_018EeWyXxfu5pfWkrYcMdjWG`.',
  RETRIEVED,
)

export const ANTHROPIC_USAGE_TOTAL_INPUT = citation(
  'https://platform.claude.com/docs/en/api/messages/create',
  'Total input tokens in a request is the summation of `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`.',
  RETRIEVED,
)

export const ANTHROPIC_USAGE_NOT_VISIBLE_CONTENT = citation(
  'https://platform.claude.com/docs/en/api/messages/create',
  "Under the hood, the API transforms requests into a format suitable for the model. The model's output then goes through a parsing stage before becoming an API response. As a result, the token counts in `usage` will not match one-to-one with the exact visible content of an API request or response.",
  RETRIEVED,
)

export const ANTHROPIC_NEW_TOKENIZER = citation(
  'https://platform.claude.com/docs/en/build-with-claude/token-counting',
  'Claude 4.7 and later models and Claude Mythos Preview use a newer tokenizer. The same input text produces approximately 30 percent more tokens than on earlier models.',
  RETRIEVED,
)
