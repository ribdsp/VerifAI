/**
 * Two fields Anthropic's OpenAI-compatible endpoint documents as always empty,
 * read from an answer sold as Claude over Chat Completions. The request asks
 * for `logprobs`, which that endpoint documents as ignored.
 *
 * A `system_fingerprint` with a value says the answer was not written by
 * Anthropic's endpoint. Token log-probabilities say more: they are computed
 * from the answering model's own output distribution, which Anthropic's
 * endpoint leaves empty, so their presence bears on which model answered as
 * well as on who served it. A layer that invents them is possible, so nothing
 * is vetoed.
 */

import {
  isJsonObject,
  type JsonObject,
  member,
  objectsIn,
  readArray,
  readObject,
  readString,
} from '../../../adapters/json.js'
import {
  ANTHROPIC_COMPAT_FINGERPRINT_EMPTY,
  ANTHROPIC_COMPAT_LOGPROBS_EMPTY,
  ANTHROPIC_COMPAT_LOGPROBS_IGNORED,
} from '../../../sources/anthropic-conformance-common.js'
import { errorOf, generationRequest, isSuccess, jsonOf, quoted, signal } from '../../shared.js'
import type { Exchange, Probe, ProbeContext, Signal } from '../../types.js'
import { TINY_PROMPT, TINY_REQUEST_TOKENS } from './shared.js'

const ID = 'conformance/common/compat-fields'

const COMMON = {
  probeId: ID,
  family: 'protocol-conformance',
  calibration: 'documented',
} as const

/** The first choice's token log-probabilities that are real ones: finite and below zero. */
function logprobsOf(body: JsonObject): readonly number[] {
  const [choice] = objectsIn(readArray(body, 'choices'))
  const logprobs = choice === undefined ? undefined : readObject(choice, 'logprobs')
  const entries = logprobs === undefined ? [] : objectsIn(readArray(logprobs, 'content'))
  return entries
    .map((entry) => member(entry, 'logprob'))
    .filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value) && value < 0,
    )
}

function fromAnswer(body: JsonObject): readonly Signal[] {
  const fingerprint = readString(body, 'system_fingerprint')
  const logprobs = logprobsOf(body)
  const signals = [
    fingerprint === undefined || fingerprint === ''
      ? undefined
      : signal({
          ...COMMON,
          signalId: 'fingerprint-present',
          observed: `The answer's system_fingerprint is ${quoted(fingerprint)}.`,
          expected: 'An empty system_fingerprint.',
          llr: { platform: { 'first-party': -0.6 } },
          plainLanguage:
            "The answer carries a system_fingerprint value. Anthropic's own OpenAI-compatible endpoint always leaves it empty, so this answer did not come from there. It says nothing about which model answers.",
          citations: [ANTHROPIC_COMPAT_FINGERPRINT_EMPTY],
        }),
    logprobs.length === 0
      ? undefined
      : signal({
          ...COMMON,
          signalId: 'logprobs-present',
          observed: `The answer carries token log-probabilities: ${logprobs.join(', ')}.`,
          expected: 'Empty logprobs: the request for them is ignored.',
          llr: {
            identity: {
              'different-vendor': 0.6,
              'matches-claim': -0.6,
              'same-vendor-cheaper': -0.6,
            },
            platform: { 'first-party': -0.6 },
          },
          plainLanguage:
            "The answer carries token probabilities. Anthropic's own OpenAI-compatible endpoint ignores a request for them and always leaves them empty. They are computed from the model that wrote the answer, which points away from Claude.",
          citations: [ANTHROPIC_COMPAT_LOGPROBS_EMPTY, ANTHROPIC_COMPAT_LOGPROBS_IGNORED],
        }),
  ]
  return signals.filter((entry) => entry !== undefined)
}

function fromRefusal(exchange: Exchange): readonly Signal[] {
  const error = errorOf(exchange)
  const namesLogprobs =
    error !== undefined && (error.param === 'logprobs' || /logprobs/i.test(error.message))
  if (!namesLogprobs) {
    return []
  }
  return [
    signal({
      ...COMMON,
      signalId: 'logprobs-rejected',
      observed: `A request asking for logprobs was refused with status ${exchange.status}: ${quoted(error.message)}.`,
      expected: 'An answer: the request for logprobs is ignored.',
      llr: { platform: { 'first-party': -0.3 } },
      plainLanguage:
        "The endpoint refused a request for token probabilities. Anthropic's own OpenAI-compatible endpoint ignores that request rather than refusing it, so this answer did not come from there. It says nothing about which model answers.",
      citations: [ANTHROPIC_COMPAT_LOGPROBS_IGNORED],
    }),
  ]
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const exchange = await context.send(
    generationRequest(context.target, {
      prompt: TINY_PROMPT,
      maxTokens: 1,
      extra: { logprobs: true },
    }),
  )
  if (isSuccess(exchange)) {
    const body = jsonOf(exchange)
    return isJsonObject(body) ? fromAnswer(body) : []
  }
  return exchange.status >= 400 && exchange.status < 500 ? fromRefusal(exchange) : []
}

export const compatFields: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Fields Anthropic's OpenAI-compatible endpoint leaves empty",
  group: 'A',
  protocols: ['openai-chat'],
  vendors: ['anthropic'],
  needsKey: true,
  cost: { requests: 1, tokens: TINY_REQUEST_TOKENS },
  citations: [
    ANTHROPIC_COMPAT_FINGERPRINT_EMPTY,
    ANTHROPIC_COMPAT_LOGPROBS_EMPTY,
    ANTHROPIC_COMPAT_LOGPROBS_IGNORED,
  ],
  run,
})
