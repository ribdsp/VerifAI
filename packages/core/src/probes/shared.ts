/**
 * What every probe needs and none should write twice: the one way to build a
 * `Signal`, and readers over an `Exchange`.
 *
 * `signal` is a gate, not a convenience. A likelihood ratio that is `NaN`, a
 * finding that is misspelt, a veto on `unknown`, a signal without a source -
 * each would reach the aggregator as a number that looks like evidence, so each
 * throws where the probe builds it instead.
 */

import { adapterFor, type RequestBody } from '../adapters/adapter.js'
import { type ErrorBody, readErrorBody } from '../adapters/error-body.js'
import type { Generation } from '../adapters/types.js'
import type { Citation } from '../sources/citation.js'
import { headerValue, headerValues } from '../transport/headers.js'
import {
  IDENTITY_FINDINGS,
  type IdentityFinding,
  PLATFORM_FINDINGS,
  TRANSLATION_FINDINGS,
} from '../types/assessment.js'
import type { Protocol } from '../types/target.js'
import type { Vocabulary } from '../types/vocabulary.js'
import {
  CALIBRATIONS,
  type Exchange,
  type LlrTable,
  type ProbeRequest,
  type ProbeTarget,
  SIGNAL_FAMILIES,
  type Signal,
} from './types.js'

/**
 * The largest log10 likelihood ratio one signal may carry for one finding.
 * The aggregator caps far lower per tier; this only catches a probe that
 * meant 1.5 and wrote 15.
 */
export const MAX_SIGNAL_LLR = 3

/** Longest `observed`, `expected` or `plainLanguage`. A report is read, not searched. */
export const MAX_SIGNAL_TEXT = 1200

const PROBE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/
const SIGNAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const AXES: Readonly<Record<keyof LlrTable, Vocabulary<string>>> = Object.freeze({
  identity: IDENTITY_FINDINGS,
  platform: PLATFORM_FINDINGS,
  translation: TRANSLATION_FINDINGS,
})

function text(name: string, value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`A signal's ${name} must be a non-empty string`)
  }
  if (value.length > MAX_SIGNAL_TEXT) {
    throw new TypeError(`A signal's ${name} is longer than ${MAX_SIGNAL_TEXT} characters`)
  }
  return value
}

function llrTable(table: LlrTable): LlrTable {
  const axes = Object.entries(table).map(([axis, findings]) => {
    const vocabulary = AXES[axis as keyof LlrTable]
    if (vocabulary === undefined) {
      throw new TypeError(`A signal names an axis that takes no likelihood ratio: ${axis}`)
    }
    if (typeof findings !== 'object' || findings === null) {
      throw new TypeError(`A signal's ${axis} ratios must be an object`)
    }
    const entries = Object.entries(findings).map(([finding, value]): [string, number] => {
      // `unknown` is the reference every ratio is measured against.
      if (!vocabulary.has(finding) || finding === 'unknown') {
        throw new TypeError(`A signal names a ${axis} finding it cannot bear on: ${finding}`)
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`A signal's ratio for ${axis} ${finding} is not a finite number`)
      }
      if (Math.abs(value) > MAX_SIGNAL_LLR) {
        throw new RangeError(`A signal's ratio for ${axis} ${finding} exceeds ${MAX_SIGNAL_LLR}`)
      }
      return [finding, value]
    })
    return [axis, Object.freeze(Object.fromEntries(entries))] as const
  })
  return Object.freeze(Object.fromEntries(axes)) as LlrTable
}

function citations(list: readonly Citation[]): readonly [Citation, ...Citation[]] {
  const [first, ...rest] = Array.isArray(list) ? list : []
  if (first === undefined) {
    throw new TypeError('A signal must cite at least one source')
  }
  for (const entry of list) {
    if (
      !Object.isFrozen(entry) ||
      typeof entry.url !== 'string' ||
      typeof entry.quote !== 'string'
    ) {
      throw new TypeError('A signal must cite sources built with citation()')
    }
  }
  const all: readonly [Citation, ...Citation[]] = [first, ...rest]
  return Object.freeze(all)
}

function vetoes(list: readonly IdentityFinding[]): readonly IdentityFinding[] {
  const unique = new Set(list)
  if (unique.size !== list.length) {
    throw new TypeError('A signal vetoes the same finding twice')
  }
  for (const finding of list) {
    if (!IDENTITY_FINDINGS.has(finding) || finding === 'unknown') {
      throw new TypeError(`A signal cannot veto ${String(finding)}`)
    }
  }
  return Object.freeze([...list])
}

/** @throws TypeError or RangeError naming the field that is wrong. */
export function signal(spec: Signal): Signal {
  if (!PROBE_ID.test(spec.probeId)) {
    throw new TypeError(`Not a probe id: ${JSON.stringify(spec.probeId)}`)
  }
  if (!SIGNAL_ID.test(spec.signalId)) {
    throw new TypeError(`Not a signal id: ${JSON.stringify(spec.signalId)}`)
  }
  if (!SIGNAL_FAMILIES.has(spec.family)) {
    throw new TypeError(`Not a signal family: ${JSON.stringify(spec.family)}`)
  }
  if (!CALIBRATIONS.has(spec.calibration)) {
    throw new TypeError(`Not a calibration tier: ${JSON.stringify(spec.calibration)}`)
  }
  return Object.freeze({
    probeId: spec.probeId,
    signalId: spec.signalId,
    family: spec.family,
    calibration: spec.calibration,
    observed: text('observed', spec.observed),
    expected: text('expected', spec.expected),
    llr: llrTable(spec.llr),
    plainLanguage: text('plainLanguage', spec.plainLanguage),
    citations: citations(spec.citations),
    ...(spec.vetoes === undefined || spec.vetoes.length === 0
      ? {}
      : { vetoes: vetoes(spec.vetoes) }),
  })
}

export function isSuccess(exchange: Exchange): boolean {
  return exchange.status >= 200 && exchange.status < 300
}

/** The parsed body, or `undefined` when it is not JSON. */
export function jsonOf(exchange: Exchange): unknown {
  return exchange.json.kind === 'json' ? exchange.json.value : undefined
}

/** The body as an error envelope in either vendor's dialect. */
export function errorOf(exchange: Exchange): ErrorBody | undefined {
  return readErrorBody(jsonOf(exchange))
}

/** The first value of a header, compared case-insensitively. */
export function header(exchange: Exchange, name: string): string | undefined {
  return headerValue(exchange.headers, name)
}

export function headers(exchange: Exchange, name: string): readonly string[] {
  return headerValues(exchange.headers, name)
}

/** The body read as a generation in `protocol`. */
export function generationOf(exchange: Exchange, protocol: Protocol): Generation | undefined {
  const value = jsonOf(exchange)
  return value === undefined ? undefined : adapterFor(protocol).readGeneration(value)
}

/**
 * `value` as it goes into `observed`: JSON-quoted, and cut to `max` characters
 * so an endpoint's page-long error cannot fill the report.
 */
export function quoted(value: string, max = 160): string {
  const cut = value.length > max ? `${value.slice(0, max)}…` : value
  return JSON.stringify(cut)
}

export interface GenerationOptions {
  readonly prompt: string
  readonly maxTokens: number
  /** Top-level fields added to, or replacing, the minimal body. */
  readonly extra?: Readonly<Record<string, unknown>>
  /** Defaults to the target's protocol. */
  readonly protocol?: Protocol
  /** Defaults to the model as the buyer named it to the endpoint. */
  readonly model?: string
}

/**
 * The Responses API is asked for at least this many output tokens, so a model
 * that must emit a few before its first visible one is not cut off at zero.
 */
export const RESPONSES_MIN_OUTPUT_TOKENS = 16

// biome-ignore-start lint/style/useNamingConvention: the vendors' wire names.
function minimalBody(
  protocol: Protocol,
  model: string,
  prompt: string,
  maxTokens: number,
): Record<string, unknown> {
  switch (protocol) {
    case 'anthropic-messages':
      return { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }
    case 'openai-chat':
      return {
        model,
        max_completion_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }
    case 'openai-responses':
      return {
        model,
        input: prompt,
        max_output_tokens: Math.max(maxTokens, RESPONSES_MIN_OUTPUT_TOKENS),
      }
  }
}
// biome-ignore-end lint/style/useNamingConvention: the vendors' wire names.

/**
 * The smallest request that asks the claimed model to generate, in the target's
 * protocol. Billed for `maxTokens` of output plus a generous allowance for the
 * prompt, which is what the budget is charged.
 */
export function generationRequest(target: ProbeTarget, options: GenerationOptions): ProbeRequest {
  const protocol = options.protocol ?? target.protocol
  const body = {
    ...minimalBody(
      protocol,
      options.model ?? target.requestedModel,
      options.prompt,
      options.maxTokens,
    ),
    ...options.extra,
  }
  const json: RequestBody = { json: body }
  return Object.freeze({
    path: adapterFor(protocol).generatePath,
    body: json,
    protocol,
    generates: true,
    tokens: estimateTokens(options.prompt) + options.maxTokens,
  })
}

/**
 * An upper bound on the tokens `text` costs as a prompt, for the budget. Every
 * tokenizer in use spends at most one token per UTF-8 byte, plus a margin for
 * the template around a message.
 */
export function estimateTokens(text: string): number {
  return new TextEncoder().encode(text).length + 64
}
