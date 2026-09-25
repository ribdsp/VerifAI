/**
 * Anthropic's words on what a Messages response reports about itself: the
 * output ceiling, the stop reason, `usage`, the response's `model` and `id`,
 * and how the partner clouds spell a model ID. Group B's accounting probes
 * check a response against these.
 */

import { citation } from './citation.js'

const MESSAGES = 'https://platform.claude.com/docs/en/api/messages/create'
const MODEL_IDS = 'https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions'
const RETRIEVED = '2026-09-24'

export const ANTHROPIC_MAX_TOKENS_CEILING = citation(
  MESSAGES,
  'This parameter only specifies the absolute maximum number of tokens to generate.',
  RETRIEVED,
)

export const ANTHROPIC_STOP_MAX_TOKENS = citation(
  MESSAGES,
  '`"max_tokens"`: we exceeded the requested `max_tokens` or the model\'s maximum',
  RETRIEVED,
)

export const ANTHROPIC_STOP_REASON_NON_NULL = citation(
  MESSAGES,
  'In non-streaming mode this value is always non-null.',
  RETRIEVED,
)

export const ANTHROPIC_OUTPUT_NON_ZERO = citation(
  MESSAGES,
  'For example, `output_tokens` will be non-zero, even for an empty string response from Claude.',
  RETRIEVED,
)

export const ANTHROPIC_OUTPUT_INCLUSIVE = citation(
  MESSAGES,
  '`output_tokens` remains the inclusive, authoritative total used for billing.',
  RETRIEVED,
)

export const ANTHROPIC_OUTPUT_BREAKDOWN = citation(
  MESSAGES,
  'Breakdown of output tokens by category.',
  RETRIEVED,
)

export const ANTHROPIC_RESPONSE_MODEL = citation(
  MESSAGES,
  'The model that will complete your prompt.',
  RETRIEVED,
)

export const ANTHROPIC_MESSAGE_ID_EXAMPLE = citation(
  MESSAGES,
  '"id": "msg_013Zva2CMHLNnXjNJJKqJ2EF",',
  RETRIEVED,
)

export const ANTHROPIC_ID_FORMAT_UNSTABLE = citation(
  MESSAGES,
  'The format and length of IDs may change over time.',
  RETRIEVED,
)

export const ANTHROPIC_BEDROCK_DATED_ID = citation(
  MODEL_IDS,
  'For example: `anthropic.claude-sonnet-4-5-20250929-v1:0`',
  RETRIEVED,
)

export const ANTHROPIC_BEDROCK_V1_SUFFIX = citation(
  MODEL_IDS,
  'Claude Opus 4.6 is the last Bedrock model ID to include the `-v1` suffix (`anthropic.claude-opus-4-6-v1`).',
  RETRIEVED,
)

export const ANTHROPIC_VERTEX_DATED_ID = citation(
  MODEL_IDS,
  'For example: `claude-haiku-4-5@20251001`',
  RETRIEVED,
)

export const ANTHROPIC_USAGE_BILLING = citation(
  MESSAGES,
  'Billing and rate-limit usage.',
  RETRIEVED,
)
