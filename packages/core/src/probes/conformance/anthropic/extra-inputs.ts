/**
 * What the endpoint does with a top-level body field the Messages API does not
 * define. Anthropic's validator refuses such a field with a 400 whose message
 * ends in `<field>: Extra inputs are not permitted`, the wording its error page
 * quotes for `thinking.block_binding`. The field sent is `seed`, which OpenAI's
 * Chat Completions API takes: a layer that reads requests the OpenAI way passes
 * it on or drops it, and the model answers.
 *
 * Heuristic: the page documents the wording for one field, not for every one.
 */

import {
  ANTHROPIC_EXTRA_INPUTS_MESSAGE,
  ANTHROPIC_EXTRA_INPUTS_STATUS,
} from '../../../sources/anthropic-conformance.js'
import { errorOf, isSuccess } from '../../shared.js'
import type { Probe, ProbeContext, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  CELL_TOKENS,
  conformanceSignal,
  describeAnswer,
  refusableRequest,
} from './shared.js'

const ID = 'conformance/anthropic/extra-inputs'

const FIELD = 'seed'
const WORDING = `${FIELD}: Extra inputs are not permitted`
const CITATIONS = [ANTHROPIC_EXTRA_INPUTS_STATUS, ANTHROPIC_EXTRA_INPUTS_MESSAGE] as const

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const exchange = await context.send(refusableRequest(context.target, { [FIELD]: 7 }))
  const common = {
    probeId: ID,
    calibration: 'heuristic' as const,
    observed: `A request carrying \`${FIELD}: 7\` was answered with ${describeAnswer(exchange)}.`,
    expected: `A 400 invalid_request_error whose message ends in "${WORDING}".`,
    citations: CITATIONS,
  }
  if (isSuccess(exchange)) {
    return [
      conformanceSignal({
        ...common,
        signalId: 'accepted',
        llr: { translation: { translated: 0.3 }, platform: { 'first-party': -0.3 } },
        plainLanguage: `The endpoint answered a request carrying ${FIELD}, a setting the Messages API does not have. Anthropic's API refuses fields it does not define.`,
      }),
    ]
  }
  if (exchange.status < 400 || exchange.status >= 500) {
    return []
  }
  const error = errorOf(exchange)
  const matches =
    exchange.status === 400 && error?.dialect === 'anthropic' && error.message.includes(WORDING)
  return [
    conformanceSignal({
      ...common,
      signalId: matches ? 'refused-as-anthropic' : 'refused-otherwise',
      llr: matches
        ? { translation: { direct: 0.2 }, platform: { 'first-party': 0.1 } }
        : { translation: { translated: 0.2 } },
      plainLanguage: matches
        ? `The endpoint refused ${FIELD}, a setting the Messages API does not have, in the words Anthropic's validator uses.`
        : `The endpoint refused ${FIELD}, a setting the Messages API does not have, but not in the words Anthropic's validator uses.`,
    }),
  ]
}

export const extraInputs: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Anthropic's refusal of an undefined body field",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  needsKey: true,
  cost: { requests: 1, tokens: CELL_TOKENS },
  citations: CITATIONS,
  run,
})
