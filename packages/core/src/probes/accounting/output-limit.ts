/**
 * Whether the baseline stayed inside the output limit its request set, and
 * said it stopped there. Both vendors define the limit as a ceiling on what
 * is generated and name the stop it causes; the baseline asks for a long
 * essay under the smallest limit each protocol accepts, so a genuine backend
 * reaches the limit and reports it.
 *
 * Output past the limit was not generated under the request that was sent: a
 * layer changed the limit, or answered from something other than a model
 * generating now. A stop reported in other words is a layer rewriting how the
 * response ended. Neither says which model is behind the layer.
 */

import {
  ANTHROPIC_MAX_TOKENS_CEILING,
  ANTHROPIC_STOP_MAX_TOKENS,
  ANTHROPIC_STOP_REASON_NON_NULL,
} from '../../sources/anthropic-accounting.js'
import type { Citation } from '../../sources/citation.js'
import {
  OPENAI_CHAT_LENGTH_FINISH,
  OPENAI_CHAT_MAX_COMPLETION_TOKENS,
  OPENAI_RESPONSES_INCOMPLETE,
  OPENAI_RESPONSES_MAX_OUTPUT_TOKENS,
} from '../../sources/openai-accounting.js'
import type { Protocol } from '../../types/target.js'
import type { Probe, ProbeContext, Signal } from '../types.js'
import { accountingSignal, BASELINE_COST, baseline, LENGTH_STOP_REASONS } from './shared.js'

const ID = 'accounting/output-limit'

/**
 * A generous bound on the UTF-8 bytes one token decodes to, so text is only
 * called too long when no tokenizer could have fitted it in the limit.
 */
const MAX_BYTES_PER_TOKEN = 128
const TEXT_MARGIN_BYTES = 64

interface Terms {
  readonly limitField: string
  readonly outputField: string
  readonly stopField: string
  readonly ceiling: Citation
  readonly stop: Citation
}

const TERMS: Readonly<Record<Protocol, Terms>> = Object.freeze({
  'anthropic-messages': {
    limitField: 'max_tokens',
    outputField: 'output_tokens',
    stopField: 'stop_reason',
    ceiling: ANTHROPIC_MAX_TOKENS_CEILING,
    stop: ANTHROPIC_STOP_MAX_TOKENS,
  },
  'openai-chat': {
    limitField: 'max_completion_tokens',
    outputField: 'completion_tokens',
    stopField: 'finish_reason',
    ceiling: OPENAI_CHAT_MAX_COMPLETION_TOKENS,
    stop: OPENAI_CHAT_LENGTH_FINISH,
  },
  'openai-responses': {
    limitField: 'max_output_tokens',
    outputField: 'output_tokens',
    stopField: 'incomplete_details.reason',
    ceiling: OPENAI_RESPONSES_MAX_OUTPUT_TOKENS,
    stop: OPENAI_RESPONSES_INCOMPLETE,
  },
})

function byteLength(text: string | undefined): number {
  return text === undefined ? 0 : new TextEncoder().encode(text).length
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { protocol } = context.target
  const { generation, outputLimit, refusedLimit } = await baseline(context)
  const terms = TERMS[protocol]
  const output = generation.usage?.output
  const textBytes = byteLength(generation.text)
  const textBound = outputLimit * MAX_BYTES_PER_TOKEN + TEXT_MARGIN_BYTES
  const { stopReason } = generation
  const lengthStop = LENGTH_STOP_REASONS[protocol]

  const reported = stopReason === undefined ? 'absent' : JSON.stringify(stopReason)
  const refused =
    refusedLimit === undefined ? '' : `, after the endpoint refused ${refusedLimit} with a 400`
  const observed = `Under ${terms.limitField} ${outputLimit}${refused}: ${terms.outputField} ${output ?? 'absent'}, ${textBytes} bytes of text, ${terms.stopField} ${reported}.`
  const expected = `At most ${outputLimit} in ${terms.outputField}, no more than ${textBound} bytes of text, and ${terms.stopField} "${lengthStop}".`

  if ((output !== undefined && output > outputLimit) || textBytes > textBound) {
    return [
      accountingSignal(ID, {
        signalId: 'over-limit',
        calibration: 'documented',
        observed,
        expected,
        llr: { identity: { 'not-a-live-model': 0.2 }, translation: { translated: 0.5 } },
        plainLanguage: `The request allowed at most ${outputLimit} token(s) of output and the response contained more. The vendor's API does not go past the limit a request sets, so this answer was not generated under the request you sent.`,
        citations: [terms.ceiling],
      }),
    ]
  }
  // A model that ends on its own before the limit reports its natural stop, which is genuine.
  const endedEarly = output !== undefined && output < outputLimit
  if (stopReason !== lengthStop && !endedEarly) {
    const isNullAnthropic = protocol === 'anthropic-messages' && stopReason === null
    return [
      accountingSignal(ID, {
        signalId: 'stop-reason',
        calibration: 'documented',
        observed,
        expected,
        llr: { translation: { translated: 0.4 } },
        plainLanguage:
          "The response reached the output limit the request set but did not report it the way the vendor's API does. A layer between you and the model rewrote how the response ended. It says nothing about which model answered.",
        citations: isNullAnthropic ? [terms.stop, ANTHROPIC_STOP_REASON_NON_NULL] : [terms.stop],
      }),
    ]
  }
  return [
    accountingSignal(ID, {
      signalId: 'within-limit',
      calibration: 'documented',
      observed,
      expected,
      llr: {},
      plainLanguage:
        "The response stayed within the output limit the request set and reported its stop the way the vendor's API does.",
      citations: [terms.ceiling, terms.stop],
    }),
  ]
}

export const outputLimit: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Output inside the requested limit',
  group: 'B',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic', 'openai'],
  needsKey: true,
  cost: BASELINE_COST,
  citations: [
    ANTHROPIC_MAX_TOKENS_CEILING,
    OPENAI_CHAT_MAX_COMPLETION_TOKENS,
    OPENAI_RESPONSES_MAX_OUTPUT_TOKENS,
  ],
  run,
})
