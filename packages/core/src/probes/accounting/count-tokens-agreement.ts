/**
 * Whether Anthropic's free counting endpoint and the generation's own `usage`
 * agree on the same messages. The endpoint counts under the tokenizer of the
 * `model` it is sent; `usage` is counted by whatever answered. Anthropic says
 * the two may differ by a small amount, so a small gap means nothing.
 *
 * A gap the size of the step between Claude tokenizers - the newer one uses
 * roughly 1x to 1.35x as many tokens - says the generation was counted under
 * the other tokenizer, which is the tokenizer of a different Claude model
 * from the one claimed. Any other gap says only that one of the two counts
 * was not Anthropic's. A counting endpoint that is missing points away from
 * Anthropic's own API, which offers it.
 */

import { anthropicModel, cheaperAnthropicModels } from '@verifai/fingerprints'
import { ANTHROPIC_COUNT_TOKENS_PATH } from '../../adapters/anthropic-messages.js'
import { isJsonObject, readCount } from '../../adapters/json.js'
import { ANTHROPIC_NEW_TOKENIZER } from '../../sources/anthropic.js'
import {
  ANTHROPIC_COUNT_ESTIMATE,
  ANTHROPIC_COUNT_SAME_INPUTS,
  ANTHROPIC_COUNT_SYSTEM_TOKENS,
  ANTHROPIC_COUNT_TOTAL,
  ANTHROPIC_COUNT_UNDER_MODEL,
  ANTHROPIC_TOKENIZER_STEP_RANGE,
} from '../../sources/anthropic-tokenizer.js'
import { MEASURED_COUNT_STEP } from '../../sources/measured-accounting.js'
import { isSuccess, jsonOf, quoted, signal } from '../shared.js'
import type { Probe, ProbeContext, ProbeRequest, Signal } from '../types.js'
import { accountingSignal, BASELINE_COST, baseline, reportedInput } from './shared.js'

const ID = 'accounting/count-tokens-agreement'

/** Counts this close are the same count, per MEASURED_COUNT_STEP. */
const AGREEMENT_TOKENS = 8
const AGREEMENT_SHARE = 0.08
/** The documented 1x to 1.35x step, widened for the counting endpoint's own error. */
const STEP_LOW = 1.08
const STEP_HIGH = 1.45

/** Statuses a server without Anthropic's counting endpoint answers it with. */
const MISSING_ENDPOINT = Object.freeze([401, 403, 404, 405])

function countRequest(model: string, prompt: string): ProbeRequest {
  return Object.freeze({
    path: ANTHROPIC_COUNT_TOKENS_PATH,
    method: 'POST',
    body: { json: { model, messages: [{ role: 'user', content: prompt }] } },
    protocol: 'anthropic-messages',
    provokes: MISSING_ENDPOINT,
    generates: false,
    tokens: 0,
  })
}

/** Whether `larger` is `smaller` stepped up by one tokenizer generation. */
function isStep(larger: number, smaller: number): boolean {
  const ratio = larger / smaller
  return (
    smaller > 0 && larger - smaller > AGREEMENT_TOKENS && ratio >= STEP_LOW && ratio <= STEP_HIGH
  )
}

function agrees(count: number, used: number): boolean {
  return Math.abs(count - used) <= Math.max(AGREEMENT_TOKENS, AGREEMENT_SHARE * used)
}

const COUNT_SOURCES = Object.freeze([
  ANTHROPIC_COUNT_UNDER_MODEL,
  ANTHROPIC_COUNT_ESTIMATE,
  ANTHROPIC_COUNT_SYSTEM_TOKENS,
  MEASURED_COUNT_STEP,
] as const)

const STEP_SOURCES = Object.freeze([
  ANTHROPIC_NEW_TOKENIZER,
  ANTHROPIC_TOKENIZER_STEP_RANGE,
  ANTHROPIC_COUNT_UNDER_MODEL,
  MEASURED_COUNT_STEP,
] as const)

const EXPECTED = `The same count from both, within ${AGREEMENT_TOKENS} tokens or ${AGREEMENT_SHARE * 100} percent.`

/** A gap of one tokenizer step: which way it points, and what a cheaper model would use. */
interface Step {
  readonly signalId: 'older-tokenizer' | 'newer-tokenizer'
  readonly cheaperTokenizer: 'claude-legacy' | 'claude-2026'
  readonly cheaperRatio: number
  readonly counted: string
}

function stepOf(claimed: string, count: number, used: number): Step | undefined {
  const tokenizer = anthropicModel(claimed)?.tokenizer?.value
  if (tokenizer === 'claude-2026' && isStep(count, used)) {
    return {
      signalId: 'older-tokenizer',
      cheaperTokenizer: 'claude-legacy',
      cheaperRatio: 0.4,
      counted: 'as Claude models before Opus 4.7 count',
    }
  }
  if (tokenizer === 'claude-legacy' && isStep(used, count)) {
    return {
      signalId: 'newer-tokenizer',
      cheaperTokenizer: 'claude-2026',
      cheaperRatio: 0.3,
      counted: 'as Claude Opus 4.7 and later models count',
    }
  }
  return undefined
}

/** The reading when the two counts differ by one tokenizer step, if they do. */
function stepSignal(
  claimed: string,
  count: number,
  used: number,
  observed: string,
): Signal | undefined {
  const step = stepOf(claimed, count, used)
  if (step === undefined) {
    return undefined
  }
  const hasCheaper = cheaperAnthropicModels(claimed).some(
    (model) => model.tokenizer?.value === step.cheaperTokenizer,
  )
  return signal({
    probeId: ID,
    family: 'tokenizer',
    signalId: step.signalId,
    calibration: 'documented',
    observed,
    expected: EXPECTED,
    llr: {
      identity: {
        'matches-claim': -0.3,
        ...(hasCheaper ? { 'same-vendor-cheaper': step.cheaperRatio } : {}),
      },
      translation: { translated: 0.2 },
    },
    plainLanguage: `Counting the same messages under ${quoted(claimed)} gave ${count} tokens; the answer reported ${used}. The gap is the one Anthropic documents between its two tokenizers, so the answer was counted ${step.counted}, which is not how ${quoted(claimed)} counts.`,
    citations: STEP_SOURCES,
  })
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { claimedModel, requestedModel } = context.target
  const { prompt, generation } = await baseline(context)
  const used = reportedInput('anthropic-messages', generation.usage)
  if (used === undefined) {
    return []
  }
  const exchange = await context.send(countRequest(requestedModel, prompt))
  const body = isSuccess(exchange) ? jsonOf(exchange) : undefined
  const count = isJsonObject(body) ? readCount(body, 'input_tokens') : undefined
  if (count === undefined) {
    return [
      accountingSignal(ID, {
        signalId: 'no-count',
        calibration: 'documented',
        observed: `Counting the baseline's messages returned status ${exchange.status} without an input_tokens count.`,
        expected: 'An input_tokens count for the messages.',
        llr: { platform: { 'first-party': -0.4 }, translation: { translated: 0.2 } },
        plainLanguage:
          "The endpoint did not count the tokens of a message. Anthropic's own API offers this count; this endpoint does not provide it.",
        citations: [ANTHROPIC_COUNT_TOTAL, ANTHROPIC_COUNT_SAME_INPUTS],
      }),
    ]
  }
  const observed = `Counting the baseline's messages gave input_tokens ${count}; the baseline's usage reported ${used}.`
  if (agrees(count, used)) {
    return [
      accountingSignal(ID, {
        signalId: 'agree',
        calibration: 'documented',
        observed,
        expected: EXPECTED,
        llr: {},
        plainLanguage:
          'The token count of the messages matched the count the answer reported. A layer that recounts both the same way would also match, so this does not show who answered.',
        citations: COUNT_SOURCES,
      }),
    ]
  }
  const step = stepSignal(claimedModel, count, used, observed)
  if (step !== undefined) {
    return [step]
  }
  return [
    accountingSignal(ID, {
      signalId: 'disagree',
      calibration: 'heuristic',
      observed,
      expected: EXPECTED,
      llr: { translation: { translated: 0.3 } },
      plainLanguage:
        "The token count of the messages and the count the answer reported differ by more than Anthropic's counts do, and not by the step between its tokenizers. One of the two counts was not made by Anthropic's API.",
      citations: COUNT_SOURCES,
    }),
  ]
}

export const countTokensAgreement: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Token counts that agree with the counting endpoint',
  group: 'B',
  protocols: ['anthropic-messages'],
  vendors: ['anthropic'],
  needsKey: true,
  cost: { requests: BASELINE_COST.requests + 1, tokens: BASELINE_COST.tokens },
  citations: [ANTHROPIC_COUNT_UNDER_MODEL, ANTHROPIC_NEW_TOKENIZER],
  run,
})
