/**
 * Shared plumbing every fake backend in this directory uses: routing raw
 * `TransportRequest`s the way VerifAI's own endpoint parsing does, decoding
 * JSON bodies, counting tokens the way each vendor's tokenizer would, and
 * building response bodies that satisfy the adapters' wire schemas exactly.
 *
 * A fake operates on `TransportRequest`/`TransportResponse` only - the same
 * boundary a real HTTP server sits behind - so it must parse URLs, headers
 * and bodies itself rather than consuming anything VerifAI has already
 * parsed for a probe.
 */

import { openaiEncodingFor } from '@verifai/fingerprints'
import { LOCAL_ENCODINGS, type LocalEncoding, loadTokenizer } from '../../../src/tokenizer/local.js'
import { headerValue } from '../../../src/transport/headers.js'
import type { TransportRequest } from '../../../src/transport/types.js'

export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type ParsedBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly value: JsonObject }
  | { readonly kind: 'malformed' }

const decoder = new TextDecoder()

export function parseBody(request: TransportRequest): ParsedBody {
  if (request.body === undefined || request.body.length === 0) {
    return { kind: 'none' }
  }
  let value: unknown
  try {
    value = JSON.parse(decoder.decode(request.body))
  } catch {
    return { kind: 'malformed' }
  }
  return isJsonObject(value) ? { kind: 'json', value } : { kind: 'malformed' }
}

export function header(request: TransportRequest, name: string): string | undefined {
  return headerValue(request.headers, name)
}

// ---- Routing ----

export type Route =
  | { readonly kind: 'anthropic-count-tokens' }
  | { readonly kind: 'anthropic-messages' }
  | { readonly kind: 'openai-chat' }
  | { readonly kind: 'openai-responses' }
  | { readonly kind: 'model-retrieve'; readonly modelId: string }
  | { readonly kind: 'models-list' }
  | { readonly kind: 'unroutable' }

function pathSegments(request: TransportRequest): readonly string[] {
  const { pathname } = new URL(request.url)
  return pathname.split('/').filter((segment) => segment.length > 0)
}

function endsWith(segments: readonly string[], suffix: readonly string[]): boolean {
  const offset = segments.length - suffix.length
  return offset >= 0 && suffix.every((segment, at) => segments[offset + at] === segment)
}

/** Mirrors the adapters' own operation suffixes, for a fake reading an incoming request. */
export function routeOf(request: TransportRequest): Route {
  const segments = pathSegments(request)
  if (endsWith(segments, ['messages', 'count_tokens'])) {
    return { kind: 'anthropic-count-tokens' }
  }
  if (endsWith(segments, ['chat', 'completions'])) {
    return { kind: 'openai-chat' }
  }
  if (endsWith(segments, ['messages'])) {
    return { kind: 'anthropic-messages' }
  }
  if (endsWith(segments, ['responses'])) {
    return { kind: 'openai-responses' }
  }
  const last = segments.at(-1)
  const secondLast = segments.at(-2)
  if (secondLast === 'models' && last !== undefined) {
    return { kind: 'model-retrieve', modelId: decodeURIComponent(last) }
  }
  if (last === 'models') {
    return { kind: 'models-list' }
  }
  return { kind: 'unroutable' }
}

// ---- Prompt text extraction ----

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (isJsonObject(block) && typeof block.text === 'string' ? block.text : ''))
      .join('')
  }
  return ''
}

/** Every message's text, in order, joined - close enough to what a tokenizer sees as input. */
export function anthropicPromptText(body: JsonObject): string {
  const system = typeof body.system === 'string' ? body.system : ''
  const messages = Array.isArray(body.messages) ? body.messages : []
  const turns = messages
    .filter(isJsonObject)
    .map((message) => textOf(message.content))
    .join('\n')
  return [system, turns].filter((part) => part.length > 0).join('\n')
}

export function openaiChatPromptText(body: JsonObject): string {
  const messages = Array.isArray(body.messages) ? body.messages : []
  return messages
    .filter(isJsonObject)
    .map((message) => textOf(message.content))
    .join('\n')
}

export function openaiResponsesPromptText(body: JsonObject): string {
  return typeof body.input === 'string' ? body.input : ''
}

// ---- Token counting ----

/**
 * The real encoding OpenAI documents for `model`, so a genuine fake's counts
 * (and its tokenizer-driven answers - forced `logit_bias` tokens, per-token
 * `logprobs`) match exactly. Falls back to `o200k_base` for anything this
 * build carries no local table for (`o200k_harmony`, on `gpt-oss-*`) - same
 * gate the real Group C probes use (`LOCAL_ENCODINGS.has`) before ever
 * calling `loadTokenizer`.
 */
export function resolvedOpenaiEncoding(model: string): LocalEncoding {
  const documented = openaiEncodingFor(model)?.value
  return documented !== undefined && LOCAL_ENCODINGS.has(documented) ? documented : 'o200k_base'
}

export async function openaiTokenCount(model: string, text: string): Promise<number> {
  const tokenizer = await loadTokenizer(resolvedOpenaiEncoding(model))
  return tokenizer.count(text)
}

type RunKind = 'latin' | 'whitespace' | 'arabic-cyrillic'

const DIVISORS: Readonly<Record<RunKind, number>> = Object.freeze({
  latin: 4,
  whitespace: 3,
  'arabic-cyrillic': 2,
})

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u
const ARABIC_CYRILLIC = /[Ѐ-ӿ؀-ۿ]/u
const LATIN_OR_DIGIT = /[0-9A-Za-z]/u
const WHITESPACE = /\s/u

function classify(char: string): RunKind | 'wide' | 'other' {
  if (CJK.test(char)) {
    return 'wide'
  }
  if (ARABIC_CYRILLIC.test(char)) {
    return 'arabic-cyrillic'
  }
  if (LATIN_OR_DIGIT.test(char)) {
    return 'latin'
  }
  if (WHITESPACE.test(char)) {
    return 'whitespace'
  }
  return 'other'
}

/**
 * A script-aware token-count heuristic for Anthropic-claiming fakes. Anthropic
 * publishes no tokenizer, so this must not happen to reproduce either public
 * OpenAI encoding: `anthropic-differential.ts` reads an exact match against
 * `o200k_base` or `cl100k_base` as evidence of an OpenAI backend underneath.
 */
export function pseudoTokenCount(text: string): number {
  let tokens = 0
  let run: RunKind | undefined
  let runLength = 0
  const flushRun = (): void => {
    if (run !== undefined) {
      tokens += Math.max(1, Math.ceil(runLength / DIVISORS[run]))
    }
    run = undefined
    runLength = 0
  }
  for (const char of text) {
    const kind = classify(char)
    if (kind === 'wide' || kind === 'other') {
      flushRun()
      tokens += 1
    } else if (kind === run) {
      runLength += 1
    } else {
      flushRun()
      run = kind
      runLength = 1
    }
  }
  flushRun()
  return tokens
}

// ---- Deterministic ids ----

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const HEX = '0123456789abcdef'

let idCounter = 0

function charOf(alphabet: string, index: number): string {
  const char = alphabet[index % alphabet.length]
  if (char === undefined) {
    throw new RangeError('index out of range')
  }
  return char
}

function generateId(alphabet: string, length: number): string {
  idCounter += 1
  const seed = idCounter
  let out = ''
  for (let index = 0; index < length; index += 1) {
    const mixed = (Math.imul(seed + index * 2654435761, 2246822519) >>> 0) + index
    out += charOf(alphabet, mixed)
  }
  return out
}

export function anthropicMessageId(): string {
  return `msg_${generateId(HEX, 24)}`
}

/** Matches `/^chatcmpl-[A-Za-z0-9]{29}$/`. */
export function chatCompletionId(): string {
  return `chatcmpl-${generateId(ALPHANUMERIC, 29)}`
}

/** Matches `/^resp_[0-9a-f]{48}$/`. */
export function responseId(): string {
  return `resp_${generateId(HEX, 48)}`
}

/** Matches `/^req_[0-9a-f]{32}$/`, the `x-request-id` header every OpenAI response carries. */
export function openaiRequestId(): string {
  return `req_${generateId(HEX, 32)}`
}

// ---- Response bodies ----

const FIXED_CREATED_AT = 1_800_000_000

export interface AnthropicMessageOptions {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly stopReason: string
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

export function anthropicMessageBody(options: AnthropicMessageOptions): JsonObject {
  // biome-ignore-start lint/style/useNamingConvention: wire format
  return {
    id: options.id,
    type: 'message',
    role: 'assistant',
    model: options.model,
    content: [{ type: 'text', text: options.text }],
    stop_reason: options.stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: options.usage.inputTokens,
      output_tokens: options.usage.outputTokens,
    },
  }
  // biome-ignore-end lint/style/useNamingConvention: wire format
}

export function anthropicErrorBody(errorType: string, message: string): JsonObject {
  return { type: 'error', error: { type: errorType, message } }
}

export interface OpenaiChatOptions {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly finishReason: string
  readonly usage: { readonly promptTokens: number; readonly completionTokens: number }
  /** `OpenaiModelFacts.systemFingerprint`: `null` where the model documents no shape at all. */
  readonly systemFingerprint: string | null
}

export function openaiChatBody(options: OpenaiChatOptions): JsonObject {
  const { promptTokens, completionTokens } = options.usage
  // biome-ignore-start lint/style/useNamingConvention: wire format
  return {
    id: options.id,
    object: 'chat.completion',
    created: FIXED_CREATED_AT,
    model: options.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: options.text },
        finish_reason: options.finishReason,
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    system_fingerprint: options.systemFingerprint,
  }
  // biome-ignore-end lint/style/useNamingConvention: wire format
}

export interface OpenaiChatErrorOptions {
  readonly message: string
  readonly type?: string
  readonly param?: string | null
  readonly code?: string | null
}

export function openaiErrorBody(options: OpenaiChatErrorOptions): JsonObject {
  return {
    error: {
      message: options.message,
      type: options.type ?? 'invalid_request_error',
      param: options.param ?? null,
      code: options.code ?? null,
    },
  }
}

export interface OpenaiResponseOptions {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly incomplete: boolean
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number }
}

export function openaiResponseBody(options: OpenaiResponseOptions): JsonObject {
  const { inputTokens, outputTokens } = options.usage
  const status = options.incomplete ? 'incomplete' : 'completed'
  // biome-ignore-start lint/style/useNamingConvention: wire format
  return {
    id: options.id,
    object: 'response',
    created_at: FIXED_CREATED_AT,
    status,
    error: null,
    incomplete_details: options.incomplete ? { reason: 'max_output_tokens' } : null,
    model: options.model,
    output: [
      {
        type: 'message',
        id: `msg_${options.id}`,
        role: 'assistant',
        status,
        content: [{ type: 'output_text', text: options.text, annotations: [] }],
      },
    ],
    access_programs: null,
    instructions: null,
    tools: [],
    tool_choice: 'auto',
    parallel_tool_calls: true,
    metadata: null,
    temperature: 1,
    top_p: 1,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  }
  // biome-ignore-end lint/style/useNamingConvention: wire format
}

/** Filler output text, roughly proportional to the tokens it must report. */
export function fillerText(tokens: number): string {
  return 'ok '.repeat(Math.max(1, tokens)).trim()
}
