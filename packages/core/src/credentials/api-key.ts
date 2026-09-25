/**
 * The one check an API key gets before it is used.
 *
 * VerifAI never interprets a key - vendors, gateways and self-hosted proxies
 * all mint their own shapes, and a buyer's LiteLLM master key is as valid a
 * target as a first-party one - so nothing here asserts a prefix or a format.
 * What it does assert is the property the transport depends on: the key goes
 * into an HTTP header verbatim, so it must be a run of visible ASCII. A CR/LF
 * in a key is a header injection, and anything outside ASCII is encoded
 * differently by every HTTP stack on the way to the endpoint.
 *
 * A refusal names the problem and nothing else. The input is a credential, so
 * no part of it is echoed back, not even the offending character.
 */

import { type Member, vocabulary } from '../types/vocabulary.js'

export const API_KEY_PROBLEMS = vocabulary(['empty', 'too-short', 'too-long', 'invalid-character'])
export type ApiKeyProblem = Member<typeof API_KEY_PROBLEMS>

export type ApiKeyResult =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly problem: ApiKeyProblem }

/**
 * Low on purpose. LiteLLM documents `sk-1234` as its example master key and
 * local gateways really are run with keys like it; the floor only catches a
 * paste that grabbed a fragment.
 */
export const MIN_API_KEY_LENGTH = 4

/**
 * Well above any vendor key, well below the 16 KiB header limit Node and most
 * servers apply. Past this, the paste was not a key.
 */
export const MAX_API_KEY_LENGTH = 4096

/** What a terminal paste or a line-oriented env file adds around a key. */
const PASTE_WHITESPACE: ReadonlySet<string> = new Set([' ', '\t', '\r', '\n'])

const FIRST_VISIBLE = 0x21
const LAST_VISIBLE = 0x7e

const REFUSALS: ReadonlyMap<ApiKeyProblem, ApiKeyResult> = new Map(
  API_KEY_PROBLEMS.values.map((problem) => [problem, Object.freeze({ ok: false, problem })]),
)

function refuse(problem: ApiKeyProblem): ApiKeyResult {
  const refusal = REFUSALS.get(problem)
  if (refusal === undefined) {
    throw new Error(`No refusal for API key problem ${problem}`)
  }
  return refusal
}

/**
 * Index-based rather than a `^\s+|\s+$` regex, which backtracks quadratically
 * on a long run of whitespace that ends in something else.
 */
function trimPasteWhitespace(input: string): string {
  let start = 0
  let end = input.length

  while (start < end && PASTE_WHITESPACE.has(input.charAt(start))) {
    start += 1
  }
  while (end > start && PASTE_WHITESPACE.has(input.charAt(end - 1))) {
    end -= 1
  }
  return input.slice(start, end)
}

function isVisibleAscii(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    if (code < FIRST_VISIBLE || code > LAST_VISIBLE) {
      return false
    }
  }
  return true
}

/** Trims paste whitespace and checks the key can travel in a header unchanged. */
export function normaliseApiKey(input: string): ApiKeyResult {
  const key = trimPasteWhitespace(input)

  if (key === '') {
    return refuse('empty')
  }
  if (key.length < MIN_API_KEY_LENGTH) {
    return refuse('too-short')
  }
  if (key.length > MAX_API_KEY_LENGTH) {
    return refuse('too-long')
  }
  if (!isVisibleAscii(key)) {
    return refuse('invalid-character')
  }
  return Object.freeze({ ok: true, key })
}
