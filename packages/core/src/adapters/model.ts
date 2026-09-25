/**
 * The model id a buyer claims, and the vendor it names.
 *
 * The id travels in a JSON body and, for the retrieve-model operation, in one
 * encoded path segment, so neither carries it anywhere it could be read as
 * syntax. What is refused is what makes an id lie on screen: control and format
 * characters. A right-to-left override or a zero-width space renders one id as
 * another in the report the buyer reads, and those characters have no place in
 * any vendor's model names.
 */

import type { Vendor } from '../types/target.js'
import { type Member, vocabulary } from '../types/vocabulary.js'

export const MODEL_ID_PROBLEMS = vocabulary(['empty', 'too-long', 'forbidden-character'])
export type ModelIdProblem = Member<typeof MODEL_ID_PROBLEMS>

export type ModelIdResult =
  | { readonly ok: true; readonly modelId: string }
  | { readonly ok: false; readonly problem: ModelIdProblem }

/** Several times the longest gateway-prefixed id in circulation. */
export const MAX_MODEL_ID_LENGTH = 256

/**
 * Controls (C0, DEL, C1), format characters (bidi overrides and isolates,
 * zero-width characters, the BOM, soft hyphen, tag characters), line and
 * paragraph separators, and lone surrogates.
 */
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u

const REFUSALS: ReadonlyMap<ModelIdProblem, ModelIdResult> = new Map(
  MODEL_ID_PROBLEMS.values.map((problem) => [problem, Object.freeze({ ok: false, problem })]),
)

function refuse(problem: ModelIdProblem): ModelIdResult {
  const refusal = REFUSALS.get(problem)
  if (refusal === undefined) {
    throw new Error(`No refusal for model id problem ${problem}`)
  }
  return refusal
}

export function normaliseModelId(input: string): ModelIdResult {
  const modelId = input.trim()

  if (modelId === '') {
    return refuse('empty')
  }
  if (modelId.length > MAX_MODEL_ID_LENGTH) {
    return refuse('too-long')
  }
  if (FORBIDDEN.test(modelId)) {
    return refuse('forbidden-character')
  }
  return Object.freeze({ ok: true, modelId })
}

/** `gpt-5`, `gpt-4o`, `gpt-3.5-turbo`, `gpt-6-astra`: a version follows `gpt`. */
const GPT_VERSION = /^\d/
/** `gpt5`, `gpt4o`, as gateways that drop the hyphen write them. Not `gpt4all`. */
const JOINED_GPT = /^gpt\d+o?$/
/** `claude`, and `claude3` as the same gateways write it. */
const CLAUDE = /^claude\d*$/
/** `o1`, `o3`, `o4-mini`. */
const O_SERIES = /^o\d$/

/**
 * Names that are families only when they lead the id or follow `openai`.
 * `o1` elsewhere is other labs' naming (`marco-o1`, `skywork-o1`).
 */
function isLeadingOpenAiFamily(token: string): boolean {
  return O_SERIES.test(token) || token === 'codex'
}

/** Open-weight models under a GPT name, served by anyone: `gpt-oss-120b`. */
const OPEN_WEIGHT_GPT: ReadonlySet<string> = new Set(['oss'])

const NAMESPACES: Readonly<Record<string, Vendor>> = Object.freeze({
  anthropic: 'anthropic',
  openai: 'openai',
})

function familyVendors(tokens: readonly string[]): ReadonlySet<Vendor> {
  const vendors = new Set<Vendor>()
  tokens.forEach((token, at) => {
    const previous = tokens[at - 1]
    const next = tokens[at + 1]
    if (CLAUDE.test(token)) {
      vendors.add('anthropic')
    } else if (token === 'chatgpt' || JOINED_GPT.test(token)) {
      vendors.add('openai')
    } else if (token === 'gpt' && next !== undefined && GPT_VERSION.test(next)) {
      vendors.add('openai')
    } else if (isLeadingOpenAiFamily(token) && (previous === undefined || previous === 'openai')) {
      vendors.add('openai')
    }
  })
  return vendors
}

/**
 * The vendor a model id names, for the `auto` choice. `undefined` when the id
 * names neither, names both, or names an open-weight model.
 *
 * A hint, never evidence: whatever an endpoint calls its model is exactly what
 * VerifAI exists to test. Family names decide before namespaces, because
 * gateways use the namespace for the protocol they translate to
 * (`openai/claude-opus-5` is Claude over an OpenAI-shaped API).
 */
export function inferVendor(modelId: string): Vendor | undefined {
  const tokens = modelId
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '')

  const gptAt = tokens.indexOf('gpt')
  if (gptAt !== -1 && OPEN_WEIGHT_GPT.has(tokens[gptAt + 1] ?? '')) {
    return undefined
  }

  const families = familyVendors(tokens)
  if (families.size > 0) {
    return families.size === 1 ? [...families][0] : undefined
  }

  const namespaces = new Set(
    tokens.flatMap((token) => (Object.hasOwn(NAMESPACES, token) ? [NAMESPACES[token]] : [])),
  )
  return namespaces.size === 1 ? [...namespaces][0] : undefined
}
