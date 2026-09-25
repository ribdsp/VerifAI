/**
 * How the endpoint refuses a model that does not exist. OpenAI answers with a
 * 404 in a fixed template - the id in backticks, a null `param`, the code
 * `model_not_found` - and a layer that maps model names itself answers in its
 * own words, or routes the made-up name to some model and lets it answer.
 *
 * The made-up id carries the run's nonce, and the 404 is one the request
 * provokes, so the runner does not take it for a mistyped model and stop.
 */

import type { ErrorBody } from '../../../adapters/error-body.js'
import { MEASURED_OPENAI_MODEL_NOT_FOUND } from '../../../sources/measured-conformance.js'
import { generationRequest, isSuccess } from '../../shared.js'
import type { Probe, ProbeContext, Signal } from '../../types.js'
import { TINY_PROMPT, TINY_REQUEST_TOKENS } from '../common/shared.js'
import { describeError, OPENAI_PROTOCOLS, observedSignal, openaiError } from './shared.js'

const ID = 'conformance/openai/model-not-found'

function isModelNotFound(error: ErrorBody | undefined, model: string): boolean {
  return (
    error !== undefined &&
    error.message === `The model \`${model}\` does not exist or you do not have access to it.` &&
    error.type === 'invalid_request_error' &&
    error.param === null &&
    error.code === 'model_not_found'
  )
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const model = `gpt-verifai-${context.nonce}-absent`
  const exchange = await context.send({
    ...generationRequest(context.target, { prompt: TINY_PROMPT, maxTokens: 1, model }),
    provokes: [404],
  })
  const expected = `A 404 with the message "The model \`${model}\` does not exist or you do not have access to it.", type "invalid_request_error", param null and code "model_not_found".`

  if (isSuccess(exchange)) {
    return [
      observedSignal(ID, MEASURED_OPENAI_MODEL_NOT_FOUND, {
        signalId: 'answered',
        observed: `A request for the made-up model ${model} was answered ${exchange.status}.`,
        expected,
        llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.1 } },
        plainLanguage:
          "The endpoint answered a request for a model that does not exist. OpenAI's own servers refuse such a request, so some model other than the one named produced this answer.",
      }),
    ]
  }
  if (exchange.status < 400 || exchange.status >= 500) {
    return []
  }
  const matches = exchange.status === 404 && isModelNotFound(openaiError(exchange), model)
  return [
    observedSignal(ID, MEASURED_OPENAI_MODEL_NOT_FOUND, {
      signalId: matches ? 'refused-as-openai' : 'refused-otherwise',
      observed: describeError(exchange),
      expected,
      llr: matches
        ? { platform: { 'first-party': 0.3 }, translation: { direct: 0.2 } }
        : { platform: { 'first-party': -0.1 } },
      plainLanguage: matches
        ? "The endpoint refused a model that does not exist in exactly the words OpenAI's own servers use."
        : "The endpoint refused a model that does not exist, but not in the words OpenAI's own servers use. It says nothing about the model behind it.",
    }),
  ]
}

export const modelNotFound: Probe = Object.freeze<Probe>({
  id: ID,
  title: "OpenAI's model-not-found template",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  needsKey: true,
  cost: { requests: 1, tokens: TINY_REQUEST_TOKENS },
  citations: [MEASURED_OPENAI_MODEL_NOT_FOUND],
  run,
})
