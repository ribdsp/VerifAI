/**
 * Anthropic's words on counting tokens: what the free counting endpoint
 * returns, how closely it tracks a billed request, and the step in counts the
 * tokenizer introduced with Claude Opus 4.7 produces.
 */

import { citation } from './citation.js'

const TOKEN_COUNTING = 'https://platform.claude.com/docs/en/build-with-claude/token-counting'
const COUNT_TOKENS = 'https://platform.claude.com/docs/en/api/messages/count_tokens'
const OPUS_5_5_MIGRATION = 'https://platform.claude.com/docs/en/models/opus-5-5/migration-guide'
const RETRIEVED = '2026-09-24'

export const ANTHROPIC_COUNT_TOTAL = citation(
  COUNT_TOKENS,
  'The total number of tokens across the provided list of messages, system prompt, and tools.',
  RETRIEVED,
)

export const ANTHROPIC_COUNT_ESTIMATE = citation(
  TOKEN_COUNTING,
  'In some cases, the actual number of input tokens used when creating a message might differ by a small amount.',
  RETRIEVED,
)

export const ANTHROPIC_COUNT_SYSTEM_TOKENS = citation(
  TOKEN_COUNTING,
  'Token counts may include tokens added automatically by Anthropic for system optimizations.',
  RETRIEVED,
)

export const ANTHROPIC_COUNT_UNDER_MODEL = citation(
  TOKEN_COUNTING,
  'The token counting endpoint counts under the tokenizer of the `model` you pass.',
  RETRIEVED,
)

export const ANTHROPIC_COUNT_SAME_INPUTS = citation(
  TOKEN_COUNTING,
  'endpoint accepts the same structured list of inputs for creating a message, including support for system prompts,',
  RETRIEVED,
)

export const ANTHROPIC_TOKENIZER_STEP_RANGE = citation(
  OPUS_5_5_MIGRATION,
  'it may use roughly 1x to 1.35x as many tokens when processing text compared to models before Claude Opus 4.7',
  RETRIEVED,
)
