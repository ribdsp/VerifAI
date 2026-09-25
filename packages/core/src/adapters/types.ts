/**
 * What every protocol adapter provides, and the reading of a generation they
 * share.
 *
 * A `Generation` is a convenience for probes that need the common core of a
 * successful response - its text, its stop reason, its usage - without caring
 * which protocol carried it. It is never the evidence itself: a probe that
 * judges a response on its shape reads the raw body, and the adapter's
 * `deviations` say how far that body strays from the protocol's documented
 * shape.
 */

import type { HeaderPair } from '../transport/types.js'
import type { Protocol } from '../types/target.js'
import { type Member, vocabulary } from '../types/vocabulary.js'
import type { Deviation } from './conformance.js'

/**
 * `x-api-key` is Anthropic's header; `bearer` is `Authorization: Bearer`,
 * which both vendors document.
 */
export const AUTH_SCHEMES = vocabulary(['x-api-key', 'bearer'])
export type AuthScheme = Member<typeof AUTH_SCHEMES>

/** At least one scheme, the default first. */
export type AuthSchemes = readonly [AuthScheme, ...AuthScheme[]]

/**
 * Token counts as the protocol reports them. The protocols disagree on what
 * `input` covers - Anthropic's `input_tokens` excludes cache reads and writes,
 * OpenAI's `prompt_tokens` and `input_tokens` include cached tokens - so compare
 * counts only within one protocol. `undefined` wherever the body sent nothing
 * that reads as a count.
 */
export interface Usage {
  readonly input: number | undefined
  readonly output: number | undefined
  /** OpenAI only; Anthropic reports no total. */
  readonly total: number | undefined
  readonly cacheRead: number | undefined
  readonly cacheCreation: number | undefined
  /** Anthropic's `thinking_tokens`, OpenAI's `reasoning_tokens`. */
  readonly reasoning: number | undefined
}

/**
 * Reasoning as each protocol carries it. `reasoning-content` is not
 * OpenAI's: it is the field DeepSeek, vLLM and OpenRouter add to a Chat
 * Completions message, and finding it is evidence about the backend.
 */
export type ReasoningItem =
  | {
      readonly kind: 'thinking'
      readonly text: string | undefined
      readonly signature: string | undefined
    }
  | { readonly kind: 'redacted-thinking'; readonly data: string | undefined }
  | {
      readonly kind: 'reasoning'
      readonly id: string | undefined
      readonly summary: readonly string[]
      readonly encryptedContent: string | null | undefined
    }
  | {
      readonly kind: 'reasoning-content'
      readonly field: 'reasoning_content' | 'reasoning'
      readonly text: string
    }

export interface Generation {
  readonly protocol: Protocol
  readonly id: string | undefined
  readonly model: string | undefined
  /** The text parts in order, joined; `undefined` when the response has none. */
  readonly text: string | undefined
  /**
   * In the protocol's own vocabulary: Anthropic's `stop_reason`, Chat
   * Completions' `finish_reason`, and for Responses the incomplete reason
   * when there is one, else the status.
   */
  readonly stopReason: string | null | undefined
  /** `undefined` when the body has no usage object. */
  readonly usage: Usage | undefined
  readonly reasoning: readonly ReasoningItem[]
  /** Chat Completions only. `null` and absent are different findings. */
  readonly systemFingerprint: string | null | undefined
  readonly serviceTier: string | null | undefined
  readonly deviations: readonly Deviation[]
}

export interface HeaderOptions {
  /** Already normalised. `undefined` for a probe that deliberately sends no key. */
  readonly apiKey: string | undefined
  readonly auth: AuthScheme
  readonly hasBody: boolean
}

export interface ProtocolAdapter {
  readonly protocol: Protocol
  /** Where a generation is requested, relative to the endpoint root. */
  readonly generatePath: string
  /** The schemes this protocol's vendor documents, the default first. */
  readonly authSchemes: AuthSchemes
  /** @throws TypeError for a scheme not in `authSchemes`. */
  readonly headers: (options: HeaderOptions) => readonly HeaderPair[]
  /** `undefined` when the body is not recognisably a generation in this protocol. */
  readonly readGeneration: (body: unknown) => Generation | undefined
}
