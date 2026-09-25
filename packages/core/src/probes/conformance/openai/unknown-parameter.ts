/**
 * What the endpoint does with a body parameter no OpenAI API defines. OpenAI
 * rejects it with a 400 naming the parameter; a layer that rebuilds the
 * request from the fields it knows drops it without a word and lets the model
 * answer. The parameter's name carries the run's nonce, so no layer can have
 * learned it in advance.
 */

import type { ErrorBody } from '../../../adapters/error-body.js'
import { MEASURED_OPENAI_UNKNOWN_PARAMETER } from '../../../sources/measured-conformance.js'
import { generationRequest, isSuccess } from '../../shared.js'
import type { Probe, ProbeContext, Signal } from '../../types.js'
import { TINY_PROMPT, TINY_REQUEST_TOKENS } from '../common/shared.js'
import { describeError, OPENAI_PROTOCOLS, observedSignal, openaiError } from './shared.js'

const ID = 'conformance/openai/unknown-parameter'

function isUnknownParameterError(error: ErrorBody | undefined, name: string): boolean {
  if (error === undefined) {
    return false
  }
  if (error.message === `Unknown parameter: '${name}'.`) {
    return error.code === 'unknown_parameter'
  }
  return error.message === `Unrecognized request argument supplied: ${name}`
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const name = `verifai_${context.nonce}`
  const exchange = await context.send(
    generationRequest(context.target, {
      prompt: TINY_PROMPT,
      maxTokens: 1,
      extra: { [name]: true },
    }),
  )
  const expected = `A 400 with code "unknown_parameter" and the message "Unknown parameter: '${name}'.", or on older routes "Unrecognized request argument supplied: ${name}".`

  if (isSuccess(exchange)) {
    return [
      observedSignal(ID, MEASURED_OPENAI_UNKNOWN_PARAMETER, {
        signalId: 'accepted',
        observed: `A request carrying the undefined parameter ${name} was answered ${exchange.status}.`,
        expected,
        llr: { platform: { 'first-party': -0.2 }, translation: { translated: 0.2 } },
        plainLanguage:
          "The endpoint answered a request containing a setting that no OpenAI API has. OpenAI's own servers refuse such a request; this one answered it.",
      }),
    ]
  }
  if (exchange.status < 400 || exchange.status >= 500) {
    return []
  }
  const matches = exchange.status === 400 && isUnknownParameterError(openaiError(exchange), name)
  return [
    observedSignal(ID, MEASURED_OPENAI_UNKNOWN_PARAMETER, {
      signalId: matches ? 'rejected-as-openai' : 'rejected-otherwise',
      observed: describeError(exchange),
      expected,
      llr: matches
        ? { platform: { 'first-party': 0.3 }, translation: { direct: 0.2 } }
        : { platform: { 'first-party': -0.1 } },
      plainLanguage: matches
        ? "The endpoint refused a setting that no OpenAI API has, in exactly the words OpenAI's own servers use."
        : "The endpoint refused a setting that no OpenAI API has, but not in the words OpenAI's own servers use. It says nothing about the model behind it.",
    }),
  ]
}

export const unknownParameter: Probe = Object.freeze<Probe>({
  id: ID,
  title: "OpenAI's unknown-parameter rejection",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  needsKey: true,
  cost: { requests: 1, tokens: TINY_REQUEST_TOKENS },
  citations: [MEASURED_OPENAI_UNKNOWN_PARAMETER],
  run,
})
