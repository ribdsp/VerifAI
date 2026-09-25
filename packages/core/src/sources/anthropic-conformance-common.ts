/**
 * Anthropic's own words for the cross-vendor probes under
 * `probes/conformance/common/`.
 *
 * Retrieved from https://platform.claude.com/docs/en/ with `.md` appended. The
 * compatibility-layer rows are quoted as the markdown table rows they are, so
 * the quote is byte-for-byte what the page serves.
 */

import { citation } from './citation.js'

const RETRIEVED = '2026-09-24'
const MESSAGES = 'https://platform.claude.com/docs/en/api/messages/create'
const COMPATIBILITY = 'https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk'

export const ANTHROPIC_TEMPERATURE_RANGE = citation(
  MESSAGES,
  'Defaults to `1.0`. Ranges from `0.0` to `1.0`.',
  RETRIEVED,
)

export const ANTHROPIC_MESSAGE_TYPE = citation(
  MESSAGES,
  'For Messages, this is always `"message"`.',
  RETRIEVED,
)

export const ANTHROPIC_COMPAT_LOGPROBS_EMPTY = citation(
  COMPATIBILITY,
  '| `logprobs`                        | Always empty                   |',
  RETRIEVED,
)

export const ANTHROPIC_COMPAT_FINGERPRINT_EMPTY = citation(
  COMPATIBILITY,
  '| `system_fingerprint`              | Always empty                   |',
  RETRIEVED,
)

export const ANTHROPIC_COMPAT_LOGPROBS_IGNORED = citation(
  COMPATIBILITY,
  '| `logprobs`              | Ignored                                                                                                                                                 |',
  RETRIEVED,
)
