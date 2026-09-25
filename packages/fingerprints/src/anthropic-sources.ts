/**
 * Every Anthropic sentence the model catalog rests on, one constant per
 * quote. `anthropic.ts` combines them into facts; keeping the words here
 * means a docs change is a diff against this file alone.
 */

import { type FactSource, source } from './source.js'

const DOCS = 'https://platform.claude.com/docs/en/'

const ERRORS = `${DOCS}api/errors`
const MESSAGES = `${DOCS}api/messages/create`
const CACHING = `${DOCS}build-with-claude/prompt-caching`
const CONTEXT = `${DOCS}build-with-claude/context-windows`
const TOKEN_COUNTING = `${DOCS}build-with-claude/token-counting`
const EXTENDED_THINKING = `${DOCS}build-with-claude/extended-thinking`
const EFFORT = `${DOCS}build-with-claude/effort`
const OVERVIEW = `${DOCS}models/overview`
const MODEL_IDS = `${DOCS}about-claude/models/model-ids-and-versions`
const FABLE_5_1 = `${DOCS}models/fable-5-1/whats-new-fable-5-1`
const OPUS_4_6 = `${DOCS}models/opus-4-6/overview`
const OPUS_4_7 = `${DOCS}models/opus-4-7/overview`
const OPUS_5_5_MIGRATION = `${DOCS}models/opus-5-5/migration-guide`
const OPUS_5_5_NEW = `${DOCS}models/opus-5-5/whats-new-opus-5-5`
const SONNET_5_MIGRATION = `${DOCS}models/sonnet-5/migration-guide`

/** The Messages reference lists every accepted `model` value as a quoted string. */
export function modelIdSource(id: string): FactSource {
  return source(MESSAGES, `"${id}"`)
}

export const ALIASES = Object.freeze({
  dated: source(
    MODEL_IDS,
    'On the Claude API, these models also have shorter aliases (for example, `claude-sonnet-4-5`) that point to the most recent dated snapshot for that minor version.',
  ),
  dateless: source(
    OVERVIEW,
    'Dateless IDs are their own pinned snapshot; the alias row repeats them.',
  ),
})

/** Per-million-token prices in USD. A price row is cited alongside its table's header row. */
export const PRICES = Object.freeze({
  overviewRow: source(
    OVERVIEW,
    '| Pricing | $10 / input MTok, $50 / output MTok | $4 / input MTok, $20 / output MTok | $2 / input MTok, $10 / output MTok | $1 / input MTok, $5 / output MTok |',
  ),
  overviewColumns: source(
    OVERVIEW,
    '| Feature | Claude Fable 5.1 | Claude Opus 5.5 | Claude Sonnet 5 | Claude Haiku 4.5 |',
  ),
  fable5: source(
    CACHING,
    'Claude Fable 5 | $10 / MTok | $12.50 / MTok | $20 / MTok | $1 / MTok | $50 / MTok',
  ),
  sameAsFable5: source(
    FABLE_5_1,
    'Claude Fable 5.1 and Claude Mythos 5.1 are priced the same as Claude Fable 5, except for cache reads',
  ),
  mythos5: source(
    CACHING,
    'Claude Mythos 5 (limited availability) | $10 / MTok | $12.50 / MTok | $20 / MTok | $1 / MTok | $50 / MTok',
  ),
  opus55: source(OPUS_5_5_NEW, 'priced at $4 / $20 USD per million input / output tokens'),
  opus5: source(
    CACHING,
    'Claude Opus 5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok',
  ),
  opus48: source(
    CACHING,
    'Claude Opus 4.8 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok',
  ),
  opus47: source(
    CACHING,
    'Claude Opus 4.7 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok',
  ),
  opus46: source(
    CACHING,
    'Claude Opus 4.6 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok',
  ),
  opus45: source(
    CACHING,
    'Claude Opus 4.5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok',
  ),
  sonnet5: source(SONNET_5_MIGRATION, 'priced at $2/$10 USD per million input/output tokens'),
  sonnet46: source(
    CACHING,
    'Claude Sonnet 4.6 | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok',
  ),
  sonnet45: source(
    CACHING,
    'Claude Sonnet 4.5 | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok',
  ),
  columns: source(
    CACHING,
    '| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |',
  ),
})

export const SAMPLING = Object.freeze({
  fable: source(
    FABLE_5_1,
    'Non-default `temperature`, `top_p`, or `top_k` values return a 400 error.',
  ),
  carriedFromFable5: source(
    FABLE_5_1,
    'These Messages API behaviors carry over from Claude Fable 5 unchanged:',
  ),
  mythos51LikeFable51: source(
    FABLE_5_1,
    'claude-mythos-5-1 | Same capabilities as Claude Fable 5.1.',
  ),
  opus47AndLater: source(
    OPUS_5_5_MIGRATION,
    'Setting `temperature`, `top_p`, or `top_k` to any non-default value on Claude Opus 4.7 and later models, including Claude Opus 5.5, returns a 400 error.',
  ),
  sonnet5: source(
    SONNET_5_MIGRATION,
    'Second, sampling parameters (`temperature`, `top_p`, `top_k`) set to non-default values return a 400 error.',
  ),
  sonnet46Breaking: source(
    SONNET_5_MIGRATION,
    'There are two breaking API changes for code already running on Claude Sonnet 4.6.',
  ),
  afterOpus46: source(
    MESSAGES,
    'Models released after Claude Opus 4.6 do not support setting temperature. A value of 1.0 will be accepted for backwards compatibility, all other values will be rejected with a 400 error.',
  ),
  topPCompatibility: source(
    MESSAGES,
    'Models released after Claude Opus 4.6 do not support setting top_p. A value >= 0.99 will be accepted for backwards compatibility, all other values will be rejected with a 400 error.',
  ),
  topKNever: source(
    MESSAGES,
    'Models released after Claude Opus 4.6 do not accept top_k; any value will be rejected with a 400 error.',
  ),
  opus46Checklist: source(
    OPUS_5_5_MIGRATION,
    'Remove `temperature`, `top_p`, and `top_k` from request payloads.',
  ),
  haiku45: source(
    SONNET_5_MIGRATION,
    '`temperature` and `top_p` work on Claude Haiku 4.5 (one at a time, not both).',
  ),
})

export const PREFILL = Object.freeze({
  from46: source(
    ERRORS,
    'Claude 4.6 and later models and Claude Mythos Preview do not support prefilling assistant messages.',
  ),
  fable: source(FABLE_5_1, 'Prefilling the assistant response returns a 400 error.'),
  opus45Accepts: source(
    OPUS_5_5_MIGRATION,
    'Prefilling assistant messages returns a 400 error on Claude Opus 4.6 and later Opus models, including Claude Opus 5.5, so this is a change only if you come from Claude Opus 4.5 or earlier.',
  ),
  sonnet46AndLater: source(
    SONNET_5_MIGRATION,
    'Prefilling assistant messages returns a `400` error on Claude Sonnet 4.6 and later models, including Claude Sonnet 5.',
  ),
  sonnet45Accepts: source(
    SONNET_5_MIGRATION,
    'This is a breaking change when migrating from Sonnet 4.5 or earlier.',
  ),
  haiku45Accepts: source(
    SONNET_5_MIGRATION,
    'Prefilling the assistant message works on Claude Haiku 4.5 but returns a 400 error on Claude Sonnet 5.',
  ),
  status: source(
    ERRORS,
    'Sending a request with a prefilled last assistant message to any of these models returns a 400 `invalid_request_error`:',
  ),
  message: source(
    ERRORS,
    'This model does not support assistant message prefill. The conversation must end with a user message.',
  ),
})

export const THINKING = Object.freeze({
  fableEnabledAndDisabled: source(
    FABLE_5_1,
    '`thinking: {"type": "enabled"}` with `budget_tokens` and `thinking: {"type": "disabled"}` both return a 400 error. Omit `thinking` or send `{"type": "adaptive"}`.',
  ),
  enabledRemovedFrom47: source(
    ERRORS,
    'Claude 4.7 and later models have removed extended thinking.',
  ),
  enabledStatus: source(
    ERRORS,
    'Sending `thinking: {"type": "enabled"}` to any of these models returns a 400 `invalid_request_error`:',
  ),
  enabledRejectedFrom47: source(
    EXTENDED_THINKING,
    'Claude 4.7 and later models do not support it and reject requests that use it, returning a 400 error.',
  ),
  enabledOnlyModeTo45: source(
    EXTENDED_THINKING,
    'On Claude 4.5 and earlier models that support thinking, extended thinking is the only available thinking mode.',
  ),
  enabledDeprecatedOn46: source(
    EXTENDED_THINKING,
    'Extended thinking (`thinking.type: "enabled"` with `budget_tokens`) is deprecated on the Claude 4.6 models (requests using it still succeed).',
  ),
  mythosPreviewBothModes: source(EXTENDED_THINKING, 'Claude Mythos Preview supports both modes.'),
  opus55EnabledAndDisabled: source(
    OPUS_5_5_NEW,
    'On Claude Opus 5.5, thinking is always on: a request that sets `thinking: {"type": "disabled"}`, or a manual budget with `thinking: {"type": "enabled", "budget_tokens": N}`, returns a 400 `invalid_request_error`.',
  ),
  opus55Adaptive: source(
    OPUS_5_5_NEW,
    'Omit the `thinking` field, or send `thinking: {"type": "adaptive"}`, which is equivalent.',
  ),
  opus5DisableUpToHigh: source(
    OPUS_5_5_NEW,
    'On Claude Opus 5, thinking is on by default and `thinking: {"type": "disabled"}` is accepted at effort `high` or below.',
  ),
  sonnet5Reversed: source(
    SONNET_5_MIGRATION,
    'On Claude Sonnet 5, the support is reversed: adaptive thinking is on by default, and manual extended thinking returns a 400 error.',
  ),
  haiku45: source(
    SONNET_5_MIGRATION,
    'Claude Haiku 4.5 supports manual extended thinking (`thinking: {type: "enabled", budget_tokens: N}`) and rejects `thinking: {type: "adaptive"}`.',
  ),
  adaptiveRejectedTo45: source(
    ERRORS,
    'Models that support only extended thinking (Claude 4.5 and earlier models) reject `thinking: {"type": "adaptive"}` with a 400 `invalid_request_error`:',
  ),
  alwaysOn: source(
    ERRORS,
    'On Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5, Claude Opus 5.5, and Claude Mythos Preview, thinking is always on. Sending `thinking: {"type": "disabled"}` to any of these models returns a 400 `invalid_request_error`.',
  ),
  alwaysOnRunsAdaptive: source(
    ERRORS,
    'Omit the `thinking` parameter and the request runs with adaptive thinking.',
  ),
  opus46Adaptive: source(
    OPUS_4_6,
    '**Claude Opus 4.6** (this model) | 1M | 128K | $5 / $25 | Adaptive (extended deprecated)',
  ),
  opus47Adaptive: source(
    OPUS_4_7,
    '**Claude Opus 4.7** (this model) | 1M | 128K | $5 / $25 | Adaptive |',
  ),
  sonnet46Adaptive: source(
    EXTENDED_THINKING,
    '**Claude Sonnet 4.6**: the beta header with manual `type: "enabled"` is still functional but deprecated. Prefer adaptive thinking, which interleaves automatically with no header.',
  ),
  opus5AndSonnet5Disable: source(
    OPUS_5_5_MIGRATION,
    'Claude Opus 5 and Claude Sonnet 5 accept `thinking: {"type": "disabled"}`.',
  ),
  opus5NotAtXhigh: source(
    EFFORT,
    'On Claude Opus 5, thinking cannot be disabled at `xhigh` or `max` effort',
  ),
})

/** The Opus 5.5 guide's bullet lists of what Opus 4.8 and Sonnet 5 share with Opus 5. */
export const LIKE_OPUS_5 = Object.freeze({
  opus48: source(OPUS_5_5_MIGRATION, 'because Claude Opus 4.8, like Claude Opus 5:'),
  opus48Accepts: source(
    OPUS_5_5_MIGRATION,
    'Accepts `thinking: {"type": "disabled"}`, forced tool choice, and the `computer_20251124` tool.',
  ),
  sonnet5: source(OPUS_5_5_MIGRATION, 'because Claude Sonnet 5, like Claude Opus 5:'),
  sonnet5Disables: source(
    OPUS_5_5_MIGRATION,
    'Runs with thinking on by default and accepts `thinking: {"type": "disabled"}`, in its case at any effort level.',
  ),
  sonnet5ForcesTools: source(
    OPUS_5_5_MIGRATION,
    'Accepts forced tool choice and the `computer_20251124` tool.',
  ),
})

export const THINKING_MESSAGES = Object.freeze({
  enabled: source(
    ERRORS,
    '"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.',
  ),
  adaptive: source(ERRORS, 'adaptive thinking is not supported on this model'),
  disabled: source(
    ERRORS,
    '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.',
  ),
  disabledMythosPreview: source(
    ERRORS,
    '"thinking.type.disabled" is not supported for this model. Thinking defaults to adaptive mode when not specified; use "thinking.type.enabled" with "budget_tokens" for extended thinking.',
  ),
})

export const FORCED_TOOL = Object.freeze({
  rejected: source(
    ERRORS,
    "Claude Opus 5.5, Claude Fable 5.1, and Claude Mythos 5.1 don't support forced tool use.",
  ),
  fable51Rejected: source(
    FABLE_5_1,
    "Claude Fable 5.1 and Claude Mythos 5.1 don't support forced tool use.",
  ),
  fable5Accepts: source(
    FABLE_5_1,
    'If you already call Claude Fable 5, three changes are breaking: forced tool use returns an error',
  ),
  opus5Accepts: source(
    OPUS_5_5_NEW,
    "Four breaking changes affect code already running on Claude Opus 5: thinking can't be disabled, forced tool use returns an error",
  ),
  status: source(
    ERRORS,
    'Sending `tool_choice: {"type": "any"}` or `tool_choice: {"type": "tool", "name": "..."}` to any of these models, including on the token counting endpoint, returns a 400 `invalid_request_error`:',
  ),
  message: source(ERRORS, 'tool_choice: type "tool" and "any" are not supported for this model.'),
})

export const CACHE_MINIMUM = Object.freeze({
  t512: source(
    CACHING,
    '512 tokens for Claude Fable 5.1, Claude Mythos 5.1, Claude Opus 5.5, Claude Opus 5, Claude Fable 5, and Claude Mythos 5',
  ),
  t2048: source(CACHING, '2,048 tokens for Claude Mythos Preview and Claude Opus 4.7'),
  t4096Opus: source(CACHING, '4,096 tokens for Claude Opus 4.6 and Claude Opus 4.5'),
  t1024: source(
    CACHING,
    '1,024 tokens for Claude Opus 4.8, Claude Sonnet 5, Claude Sonnet 4.6, Claude Sonnet 4.5,',
  ),
  t4096Haiku: source(CACHING, '4,096 tokens for Claude Haiku 4.5'),
  fable: source(FABLE_5_1, 'The minimum cacheable prompt length is 512 tokens.'),
})

export const TOKENIZER = Object.freeze({
  from47: source(
    TOKEN_COUNTING,
    'Claude 4.7 and later models and Claude Mythos Preview use a newer tokenizer.',
  ),
  earlierModels: source(
    TOKEN_COUNTING,
    'The same input text produces approximately 30 percent more tokens than on earlier models.',
  ),
  opus47Introduced: source(
    OPUS_5_5_MIGRATION,
    'Claude Opus 4.7 introduced a new tokenizer, which later Opus models, including Claude Opus 5.5, also use.',
  ),
  fable: source(
    FABLE_5_1,
    '**Tokenizer:** the same as Claude Fable 5 (introduced with Claude Opus 4.7).',
  ),
  sonnet5: source(
    SONNET_5_MIGRATION,
    'Claude Sonnet 5 uses a new tokenizer. The same input text produces approximately 30% more tokens than on Claude Sonnet 4.6.',
  ),
  haiku45: source(SONNET_5_MIGRATION, 'Claude Sonnet 5 also uses a different tokenizer'),
})

export const LIMITS = Object.freeze({
  oneMillion: source(
    CONTEXT,
    'Claude Fable 5.1, Claude Mythos 5.1, Claude Fable 5, Claude Mythos 5, Claude Opus 5.5, Claude Opus 5, Claude Opus 4.8, Claude Opus 4.7, Claude Opus 4.6, Claude Sonnet 5, Claude Sonnet 4.6, and Claude Mythos Preview have a 1M-token context window. A single request to any of them can generate up to 128k output tokens (`max_tokens`).',
  ),
  otherModels: source(
    CONTEXT,
    'Other Claude models, including Claude Sonnet 4.5, have a 200k-token context window.',
  ),
  haiku45: source(
    SONNET_5_MIGRATION,
    'Claude Haiku 4.5 uses manual extended thinking (off by default), a 200k token context window, and up to 64k output tokens',
  ),
  windowExceeded: source(
    CONTEXT,
    'On Claude 4.5 models and newer, if input tokens plus `max_tokens` exceeds the context window size, the API accepts the request. If generation then reaches the context window limit, it stops with `stop_reason: "model_context_window_exceeded"`.',
  ),
})
