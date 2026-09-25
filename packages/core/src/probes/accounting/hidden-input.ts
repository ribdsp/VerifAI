/**
 * Whether the input the baseline reported fits the prompt that was sent. The
 * baseline is one user message - no system prompt, no tools - so what a
 * vendor counts as its input is that message and the few tokens of the
 * message template. The prompt is counted here with OpenAI's public
 * `o200k_base` as a yardstick, not as the model's own tokenizer: Claude's,
 * which are not public, were measured at 1.1 and 1.55 times its count.
 *
 * Input several times the prompt is input the buyer did not send: a layer put
 * its own text, most often a hidden system prompt, in front of the message,
 * and a seller who bills by reported usage bills it on every request. That is
 * a fact about the layer, not about which model read the result, so identity
 * never moves.
 */

import { ANTHROPIC_USAGE_TOTAL_INPUT } from '../../sources/anthropic.js'
import type { Citation } from '../../sources/citation.js'
import { MEASURED_ADDED_INPUT } from '../../sources/measured-accounting.js'
import { OPENAI_CHAT_PROMPT_TOKENS } from '../../sources/openai.js'
import { OPENAI_RESPONSES_INPUT_TOKENS } from '../../sources/openai-accounting.js'
import { loadTokenizer } from '../../tokenizer/local.js'
import type { Protocol } from '../../types/target.js'
import type { Probe, ProbeContext, Signal } from '../types.js'
import { accountingSignal, BASELINE_COST, baseline, reportedInput } from './shared.js'

const ID = 'accounting/hidden-input'

/** Per MEASURED_ADDED_INPUT: no tokenizer measured counts the prompt at even twice `o200k_base`. */
const ADDED_RATIO = 3
/** The message template, per the same entry. */
const TEMPLATE_TOKENS = 64

interface Terms {
  /** The usage fields the reported count adds up. */
  readonly counted: string
  readonly field: Citation
}

const TERMS: Readonly<Record<Protocol, Terms>> = Object.freeze({
  'anthropic-messages': {
    counted: 'input_tokens plus cache reads and writes',
    field: ANTHROPIC_USAGE_TOTAL_INPUT,
  },
  'openai-chat': { counted: 'prompt_tokens', field: OPENAI_CHAT_PROMPT_TOKENS },
  'openai-responses': { counted: 'input_tokens', field: OPENAI_RESPONSES_INPUT_TOKENS },
})

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { protocol } = context.target
  const { prompt, generation } = await baseline(context)
  const reported = reportedInput(protocol, generation.usage)
  // No usage at all is accounting/usage-arithmetic's finding.
  if (reported === undefined) {
    return []
  }
  const local = (await loadTokenizer('o200k_base')).count(prompt)
  const bound = ADDED_RATIO * local + TEMPLATE_TOKENS
  const terms = TERMS[protocol]
  const observed = `${reported} input tokens (${terms.counted}) for a prompt of ${local} tokens under o200k_base.`
  const expected = `At most ${bound} input tokens: ${ADDED_RATIO} times the prompt's o200k_base count, plus ${TEMPLATE_TOKENS} for the message template.`
  const citations = [MEASURED_ADDED_INPUT, terms.field] as const

  if (reported <= bound) {
    return [
      accountingSignal(ID, {
        signalId: 'no-added-input',
        calibration: 'heuristic',
        observed,
        expected,
        llr: {},
        plainLanguage:
          'The input the endpoint reported fits the prompt that was sent. Anything put in front of it, if anything was, is smaller than about twice the prompt.',
        citations,
      }),
    ]
  }
  return [
    accountingSignal(ID, {
      signalId: 'added-input',
      calibration: 'heuristic',
      observed,
      expected,
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.3 } },
      plainLanguage: `The endpoint reported ${reported} input tokens for a prompt of about ${local}, ${Math.round(reported / local)} times its size. Text you did not send, such as a hidden system prompt, was put in front of your message before the model read it, and if you are billed by reported usage, it is billed to you on every request. It says nothing about which model answered.`,
      citations,
    }),
  ]
}

export const hiddenInput: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Input that fits the prompt sent',
  group: 'B',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic', 'openai'],
  needsKey: true,
  cost: BASELINE_COST,
  citations: [
    MEASURED_ADDED_INPUT,
    ANTHROPIC_USAGE_TOTAL_INPUT,
    OPENAI_CHAT_PROMPT_TOKENS,
    OPENAI_RESPONSES_INPUT_TOKENS,
  ],
  run,
})
