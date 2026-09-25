/**
 * How the endpoint words its refusal of `temperature: 99`. OpenAI answers an
 * out-of-range value in an idiosyncratic template - the float rendered `99.0`,
 * the code `decimal_above_max_value` - and a model that takes only the default
 * temperature in a template that differs between Chat Completions and the
 * Responses API. A refusal in the other route's words is what a gateway that
 * serves one OpenAI API by calling the other produces.
 *
 * An endpoint that accepts the value is `common/permissive-validator`'s
 * finding, not this probe's; the two read the same request. OpenAI refuses it
 * with a 400, so a refusal with any other status is in words of its own.
 */

import type { ErrorBody } from '../../../adapters/error-body.js'
import type { Citation } from '../../../sources/citation.js'
import {
  MEASURED_OPENAI_TEMPERATURE_ABOVE_MAX,
  MEASURED_OPENAI_TEMPERATURE_BY_ROUTE,
} from '../../../sources/measured-conformance.js'
import type { Protocol } from '../../../types/target.js'
import type { LlrTable, Probe, ProbeContext, Signal } from '../../types.js'
import { outOfRangeTemperature, TINY_REQUEST_TOKENS } from '../common/shared.js'
import { describeError, OPENAI_PROTOCOLS, observedSignal, openaiError } from './shared.js'

const ID = 'conformance/openai/temperature-above-max'

const ABOVE_MAX =
  /^Invalid 'temperature': decimal above maximum value\. Expected a value <= 2, but got 99(?:\.0)? instead\.$/
const CHAT_DEFAULT_ONLY =
  /^Unsupported value: 'temperature' does not support 99(?:\.0)? with this model\. Only the default \(1\) value is supported\.$/
const RESPONSES_DEFAULT_ONLY =
  "Unsupported parameter: 'temperature' is not supported with this model."

type Wording = 'above-max' | 'own-route' | 'other-route' | 'other'

function isChatDefaultOnly(error: ErrorBody): boolean {
  return CHAT_DEFAULT_ONLY.test(error.message)
}

function isResponsesDefaultOnly(error: ErrorBody): boolean {
  return error.message === RESPONSES_DEFAULT_ONLY && error.code === null
}

function wordingOf(error: ErrorBody | undefined, protocol: Protocol): Wording {
  if (error === undefined) {
    return 'other'
  }
  if (ABOVE_MAX.test(error.message) && error.code === 'decimal_above_max_value') {
    return 'above-max'
  }
  const [own, other] =
    protocol === 'openai-chat'
      ? [isChatDefaultOnly(error), isResponsesDefaultOnly(error)]
      : [isResponsesDefaultOnly(error), isChatDefaultOnly(error)]
  if (own) {
    return 'own-route'
  }
  return other ? 'other-route' : 'other'
}

interface Outcome {
  readonly llr: LlrTable
  readonly source: Citation
  readonly plainLanguage: string
}

const OUTCOMES: Readonly<Record<Wording, Outcome>> = Object.freeze({
  'above-max': {
    llr: { platform: { 'first-party': 0.3 }, translation: { direct: 0.2 } },
    source: MEASURED_OPENAI_TEMPERATURE_ABOVE_MAX,
    plainLanguage:
      "The endpoint refused an out-of-range temperature in exactly the words OpenAI's own servers use.",
  },
  'own-route': {
    llr: { platform: { 'first-party': 0.2 }, translation: { direct: 0.1 } },
    source: MEASURED_OPENAI_TEMPERATURE_BY_ROUTE,
    plainLanguage:
      "The endpoint refused the temperature in exactly the words OpenAI's own servers use on this route for a model that takes only the default.",
  },
  'other-route': {
    llr: { platform: { 'first-party': -0.2 }, translation: { translated: 0.2 } },
    source: MEASURED_OPENAI_TEMPERATURE_BY_ROUTE,
    plainLanguage:
      'The endpoint refused the temperature in the words OpenAI uses on its other API, not on the one this request was sent to. That is what a layer serving one OpenAI API by calling the other returns; it says nothing about which model answers.',
  },
  other: {
    llr: { platform: { 'first-party': -0.1 } },
    source: MEASURED_OPENAI_TEMPERATURE_ABOVE_MAX,
    plainLanguage:
      "The endpoint refused an out-of-range temperature, but not in the words OpenAI's own servers use. It says nothing about the model behind it.",
  },
})

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const exchange = await outOfRangeTemperature(context)
  if (exchange.status < 400 || exchange.status >= 500) {
    return []
  }
  const wording =
    exchange.status === 400 ? wordingOf(openaiError(exchange), context.target.protocol) : 'other'
  const outcome = OUTCOMES[wording]
  return [
    observedSignal(ID, outcome.source, {
      signalId: wording,
      observed: describeError(exchange),
      expected:
        'A 400 with code "decimal_above_max_value": "Invalid \'temperature\': decimal above maximum value. Expected a value <= 2, but got 99.0 instead.", or this route\'s own wording for a model that takes only the default temperature.',
      llr: outcome.llr,
      plainLanguage: outcome.plainLanguage,
    }),
  ]
}

export const temperatureAboveMax: Probe = Object.freeze<Probe>({
  id: ID,
  title: "OpenAI's temperature-range wording",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  needsKey: true,
  cost: { requests: 1, tokens: TINY_REQUEST_TOKENS },
  citations: [MEASURED_OPENAI_TEMPERATURE_ABOVE_MAX, MEASURED_OPENAI_TEMPERATURE_BY_ROUTE],
  run,
})
