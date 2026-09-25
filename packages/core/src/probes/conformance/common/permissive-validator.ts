/**
 * Whether the endpoint validates `temperature` at all. Both vendors document a
 * ceiling - 2 for OpenAI, 1 for Anthropic - and refuse a value above it, so a
 * genuine native endpoint answers `temperature: 99` with a 4xx. A layer that
 * rebuilds the request from the fields it knows, or clamps them before passing
 * them on, answers it. Which model then answers is another probe's question.
 *
 * Only native pairings are asked: Anthropic's OpenAI-compatible endpoint caps
 * the value at 1 instead of refusing it, so a success there is the documented
 * behaviour, not a finding.
 */

import { ANTHROPIC_TEMPERATURE_RANGE } from '../../../sources/anthropic-conformance-common.js'
import type { Citation } from '../../../sources/citation.js'
import {
  OPENAI_CHAT_TEMPERATURE_RANGE,
  OPENAI_RESPONSES_TEMPERATURE_RANGE,
} from '../../../sources/openai-conformance.js'
import type { Protocol } from '../../../types/target.js'
import { errorOf, isSuccess, quoted, signal } from '../../shared.js'
import type { Exchange, Probe, ProbeContext, ProbeTarget, Signal } from '../../types.js'
import { OUT_OF_RANGE_TEMPERATURE, outOfRangeTemperature, TINY_REQUEST_TOKENS } from './shared.js'

const ID = 'conformance/common/permissive-validator'

const RANGES: Readonly<Record<Protocol, Citation>> = Object.freeze({
  'anthropic-messages': ANTHROPIC_TEMPERATURE_RANGE,
  'openai-chat': OPENAI_CHAT_TEMPERATURE_RANGE,
  'openai-responses': OPENAI_RESPONSES_TEMPERATURE_RANGE,
})

const CEILINGS: Readonly<Record<Protocol, number>> = Object.freeze({
  'anthropic-messages': 1,
  'openai-chat': 2,
  'openai-responses': 2,
})

function refusal(exchange: Exchange): string {
  const error = errorOf(exchange)
  return error === undefined
    ? `status ${exchange.status}`
    : `status ${exchange.status}: ${quoted(error.message)}`
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const exchange = await outOfRangeTemperature(context)
  const { protocol } = context.target
  const expected = `A 4xx: the documented maximum temperature is ${CEILINGS[protocol]}.`
  const common = {
    probeId: ID,
    family: 'protocol-conformance',
    calibration: 'documented',
    expected,
    citations: [RANGES[protocol]],
  } as const

  if (isSuccess(exchange)) {
    return [
      signal({
        ...common,
        signalId: 'accepted',
        observed: `A request with temperature ${OUT_OF_RANGE_TEMPERATURE} was answered ${exchange.status}.`,
        llr: {
          platform: { 'first-party': -0.4 },
          translation: { translated: 0.6, direct: -0.6 },
        },
        plainLanguage: `The endpoint answered a request whose temperature setting is far above the maximum of ${CEILINGS[protocol]} that the vendor's own API accepts. The vendor's own API refuses such a request, so something between you and it rewrites or drops the setting. It says nothing about which model answers.`,
      }),
    ]
  }
  if (exchange.status < 400 || exchange.status >= 500) {
    return []
  }
  return [
    signal({
      ...common,
      signalId: 'rejected',
      observed: `A request with temperature ${OUT_OF_RANGE_TEMPERATURE} was refused with ${refusal(exchange)}.`,
      llr: { translation: { direct: 0.1 } },
      plainLanguage:
        "The endpoint refused a temperature setting above the vendor's documented maximum, as the vendor's own API does.",
    }),
  ]
}

export const permissiveValidator: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Out-of-range temperature',
  group: 'A',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic', 'openai'],
  applies: (target: ProbeTarget) => target.pairing === 'native',
  needsKey: true,
  cost: { requests: 1, tokens: TINY_REQUEST_TOKENS },
  citations: [
    ANTHROPIC_TEMPERATURE_RANGE,
    OPENAI_CHAT_TEMPERATURE_RANGE,
    OPENAI_RESPONSES_TEMPERATURE_RANGE,
  ],
  run,
})
