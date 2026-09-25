/**
 * Every OpenAI sentence, table row and tiktoken mapping the catalog rests on.
 * `openai.ts` combines them into facts.
 */

import { type FactSource, source } from './source.js'

const API = 'https://developers.openai.com/api/'

const CHAT = `${API}reference/resources/chat`
const PROMPT_CACHING = `${API}docs/guides/prompt-caching`

/** tiktoken is OpenAI's own tokenizer library; its model table is the published mapping. */
const TIKTOKEN_MODELS = 'https://github.com/openai/tiktoken/blob/main/tiktoken/model.py'

/**
 * The Chat Completions `model` enum, in the reference's order: the three
 * values it names outright, then the "85 more".
 */
export const OPENAI_CHAT_MODEL_IDS: readonly string[] = Object.freeze([
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.5-2026-04-23',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.4-mini-2026-03-17',
  'gpt-5.4-nano-2026-03-17',
  'gpt-5.3-chat-latest',
  'gpt-5.2',
  'gpt-5.2-2025-12-11',
  'gpt-5.2-chat-latest',
  'gpt-5.2-pro',
  'gpt-5.2-pro-2025-12-11',
  'gpt-5.1',
  'gpt-5.1-2025-11-13',
  'gpt-5.1-codex',
  'gpt-5.1-mini',
  'gpt-5.1-chat-latest',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-2025-08-07',
  'gpt-5-mini-2025-08-07',
  'gpt-5-nano-2025-08-07',
  'gpt-5-chat-latest',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4.1-2025-04-14',
  'gpt-4.1-mini-2025-04-14',
  'gpt-4.1-nano-2025-04-14',
  'o4-mini',
  'o4-mini-2025-04-16',
  'o3',
  'o3-2025-04-16',
  'o3-mini',
  'o3-mini-2025-01-31',
  'o1',
  'o1-2024-12-17',
  'o1-preview',
  'o1-preview-2024-09-12',
  'o1-mini',
  'o1-mini-2024-09-12',
  'gpt-4o',
  'gpt-4o-2024-11-20',
  'gpt-4o-2024-08-06',
  'gpt-4o-2024-05-13',
  'gpt-audio-mini',
  'gpt-audio-mini-2025-12-15',
  'gpt-4o-audio-preview',
  'gpt-4o-audio-preview-2024-10-01',
  'gpt-4o-audio-preview-2024-12-17',
  'gpt-4o-audio-preview-2025-06-03',
  'gpt-4o-mini-audio-preview',
  'gpt-4o-mini-audio-preview-2024-12-17',
  'gpt-4o-search-preview',
  'gpt-4o-mini-search-preview',
  'gpt-4o-search-preview-2025-03-11',
  'gpt-4o-mini-search-preview-2025-03-11',
  'chatgpt-4o-latest',
  'codex-mini-latest',
  'gpt-4o-mini',
  'gpt-4o-mini-2024-07-18',
  'gpt-4-turbo',
  'gpt-4-turbo-2024-04-09',
  'gpt-4-0125-preview',
  'gpt-4-turbo-preview',
  'gpt-4-1106-preview',
  'gpt-4-vision-preview',
  'gpt-4',
  'gpt-4-0314',
  'gpt-4-0613',
  'gpt-4-32k',
  'gpt-4-32k-0314',
  'gpt-4-32k-0613',
  'gpt-3.5-turbo',
  'gpt-3.5-turbo-16k',
  'gpt-3.5-turbo-0301',
  'gpt-3.5-turbo-0613',
  'gpt-3.5-turbo-1106',
  'gpt-3.5-turbo-0125',
  'gpt-3.5-turbo-16k-0613',
])

/** The chat reference lists each accepted `model` value as a quoted string. */
export function chatModelSource(id: string): FactSource {
  return source(CHAT, `"${id}"`)
}

/** A `MODEL_TO_ENCODING` or `MODEL_PREFIX_TO_ENCODING` line, quoted as written. */
export function tiktokenSource(name: string, encoding: string): FactSource {
  return source(TIKTOKEN_MODELS, `"${name}": "${encoding}"`)
}

/** `encoding_name_for_model`: an exact name wins, then the first prefix in table order. */
export const TIKTOKEN_LOOKUP = Object.freeze({
  exactFirst: source(
    TIKTOKEN_MODELS,
    'if model_name in MODEL_TO_ENCODING: return MODEL_TO_ENCODING[model_name]',
  ),
  firstPrefix: source(
    TIKTOKEN_MODELS,
    'for model_prefix, encoding_name in MODEL_PREFIX_TO_ENCODING.items(): if model_name.startswith(model_prefix): return encoding_name',
  ),
})

export const FINGERPRINT = Object.freeze({
  optional: source(CHAT, '`system_fingerprint: optional string`'),
  meaning: source(
    CHAT,
    'This fingerprint represents the backend configuration that the model runs with.',
  ),
  streamExample: source(CHAT, '"model":"gpt-6-astra", "system_fingerprint": "fp_44709d6fcb"'),
  example: source(CHAT, '"system_fingerprint": "fp_50cad350e4"'),
  nullExample: source(CHAT, '"system_fingerprint": null'),
})

const MODELS = `${API}docs/models/`
const LATEST_MODEL = `${API}docs/guides/latest-model`
const GPT_5_2_GUIDE = `${LATEST_MODEL}/gpt-5.2`
const GPT_5_GUIDE = `${LATEST_MODEL}/gpt-5`
const REASONING = `${API}docs/guides/reasoning`

/** The day the model pages and model guides below were checked, after the rest of the release. */
const MODELS_RETRIEVED_AT = '2026-09-25'

function modelPage(id: string, quote: string): FactSource {
  return source(`${MODELS}${id}`, quote, MODELS_RETRIEVED_AT)
}

/** A model page's "Model details" line naming the snapshot `id` resolves to. */
export function defaultSnapshotSource(id: string, snapshot: string): FactSource {
  return modelPage(id, `Default snapshot: \`${snapshot}\``)
}

/** A model page's "Text tokens" price table: the column header, then the row. */
export function priceSource(id: string, metric: 'Input' | 'Output', usd: string): FactSource {
  return modelPage(id, `| ${metric} | $${usd} | 1M tokens |`)
}

export function priceColumnsSource(id: string): FactSource {
  return modelPage(id, '| Metric | Price | Unit |')
}

/** Each model page's own list of `reasoning.effort` values, as it words it. */
export const EFFORT_LINES = Object.freeze({
  gpt52: modelPage(
    'gpt-5.2',
    'Reasoning.effort supports: none (default), low, medium, high and xhigh.',
  ),
  gpt51: modelPage('gpt-5.1', 'Reasoning.effort supports: none (default), low, medium, and high.'),
  gpt5: modelPage('gpt-5', 'Reasoning.effort supports: minimal, low, medium, and high.'),
  astra: modelPage(
    'gpt-6-astra',
    '`reasoning.effort` supports `low`, `medium`, `high`, `xhigh`, and `max`.',
  ),
  sol: modelPage(
    'gpt-6-sol',
    '`reasoning.effort` supports `none`, `low`, `medium` (default), `high`, `xhigh`, and `max`.',
  ),
  luna: modelPage(
    'gpt-6-luna',
    '`reasoning.effort` supports `none`, `low`, `medium` (default), `high`, `xhigh`, and `max`.',
  ),
})

/** The GPT-5 guide, which speaks for `gpt-5-mini` and `gpt-5-nano` where their pages are silent. */
export const GPT_5_FAMILY = Object.freeze({
  members: source(
    GPT_5_GUIDE,
    'The GPT-5 family includes `gpt-5`, `gpt-5-mini`, and `gpt-5-nano`.',
    MODELS_RETRIEVED_AT,
  ),
  efforts: source(
    GPT_5_GUIDE,
    '`reasoning.effort` supports `minimal`, `low`, `medium`, and `high`.',
    MODELS_RETRIEVED_AT,
  ),
})

/** "GPT-5.2 parameter compatibility", in the GPT-5.2 guide. */
export const SAMPLING_BY_EFFORT = Object.freeze({
  onlyAtNone: source(
    GPT_5_2_GUIDE,
    'The following parameters are **only supported** when using GPT-5.2 with reasoning effort set to `none`:',
    MODELS_RETRIEVED_AT,
  ),
  parameters: source(GPT_5_2_GUIDE, '- `temperature` - `top_p` - `logprobs`', MODELS_RETRIEVED_AT),
  otherwiseError: source(
    GPT_5_2_GUIDE,
    'Requests to GPT-5.2 or GPT-5.1 with any other reasoning effort setting, or to older GPT-5 models—for example, `gpt-5`, `gpt-5-mini`, or `gpt-5-nano`—that include these fields will raise an error.',
    MODELS_RETRIEVED_AT,
  ),
})

export const NONE_EFFORT = Object.freeze({
  astraRejected: source(
    REASONING,
    'GPT-6 Astra does not support `none` reasoning effort. Setting `reasoning.effort` (Responses) or `reasoning_effort` (Chat Completions) to `none` returns HTTP 400.',
    MODELS_RETRIEVED_AT,
  ),
  gpt6Limitation: source(
    LATEST_MODEL,
    'GPT-6 Astra does not support the `none` reasoning effort; GPT-6 Sol and Luna do.',
    MODELS_RETRIEVED_AT,
  ),
})

export const PROMPT_CACHE = Object.freeze({
  minimum: source(
    PROMPT_CACHING,
    'The minimum cacheable prompt length is 1,024 tokens for GPT-5.6 and later and varies by request settings for earlier models.',
  ),
  columns: source(
    PROMPT_CACHING,
    '| Behavior | GPT-5.6 and later | GPT-5.5 and GPT-5.5 Pro | Other earlier models |',
  ),
  minimumRow: source(
    PROMPT_CACHING,
    '| Minimum cacheable prefix | 1,024 visible input tokens | Varies by request settings | Varies by request settings |',
  ),
  reportingRow: source(
    PROMPT_CACHING,
    '| Cached-token reporting | Exact eligible boundary, excluding hidden tokens | Excludes hidden tokens and rounds down to a multiple of 128 | Excludes hidden tokens and rounds down to a multiple of 128 |',
  ),
  earlierRounding: source(
    PROMPT_CACHING,
    'Reported `cached_tokens` is calculated by subtracting the hidden system tokens from the last matched breakpoint, then rounding down to the nearest multiple of 128.',
  ),
})
