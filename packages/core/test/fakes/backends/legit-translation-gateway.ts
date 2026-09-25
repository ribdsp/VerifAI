/**
 * Backend #7: `legit-translation-gateway`. A genuine Claude model behind a
 * gateway that reshapes its calls into OpenAI's chat-completions wire: the
 * model field, the token counts and the sampling quirks are all the real
 * model's, translated rather than reinvented. What marks it as a translation
 * rather than a native OpenAI deployment is exactly what a genuine OpenAI
 * server would never leave blank: no system fingerprint to report, and no
 * logprobs a Claude model could ever produce.
 *
 * `openai-chat` claiming `anthropic` is `cross-protocol` pairing - a lower
 * confidence ceiling than `native`, but `translated` is not `fail`: every
 * field this gateway reports is faithful to the Claude model actually
 * answering, just carried over a wire it was not born speaking.
 */

import { ANTHROPIC_REJECTIONS } from '@verifai/fingerprints'
import type { TransportRequest, TransportResponse } from '../../../src/transport/types.js'
import type { Answer } from '../transport.js'
import { response } from '../transport.js'
import { type AnthropicModelFacts, anthropicFactsFor } from './model-facts.js'
import {
  chatCompletionId,
  isJsonObject,
  type JsonObject,
  openaiChatBody,
  openaiChatPromptText,
  openaiErrorBody,
  parseBody,
  pseudoTokenCount,
  routeOf,
} from './shared.js'

export interface LegitTranslationGatewayOptions {
  readonly answeringModel: string
}

const ANSWER_TEXT = 'ok'
const MINIMUM_ACCEPTED_TOP_P = 0.99
const ACCEPTED_TEMPERATURE = 1

function jsonResponse(status: number, body: JsonObject): TransportResponse {
  return response(status, JSON.stringify(body), [['Content-Type', 'application/json']])
}

function rejected(message: string): TransportResponse {
  return jsonResponse(400, openaiErrorBody({ message }))
}

/** The real Claude model's own sampling quirks, translated into an OpenAI-chat rejection. */
function samplingRejection(
  body: JsonObject,
  facts: AnthropicModelFacts,
): TransportResponse | undefined {
  if (!facts.rejectsSamplingParameters) {
    return undefined
  }
  if (typeof body.temperature === 'number' && body.temperature !== ACCEPTED_TEMPERATURE) {
    return rejected('Unsupported value: temperature')
  }
  if (typeof body.top_p === 'number' && body.top_p < MINIMUM_ACCEPTED_TOP_P) {
    return rejected('Unsupported value: top_p')
  }
  return undefined
}

function prefillRejection(
  body: JsonObject,
  facts: AnthropicModelFacts,
): TransportResponse | undefined {
  const messages = Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : []
  const last = messages.at(-1)
  return facts.rejectsPrefill && last?.role === 'assistant'
    ? rejected(ANTHROPIC_REJECTIONS.prefill.value.message)
    : undefined
}

/** A genuine Claude model, reshaped into OpenAI's chat-completions wire. */
export function legitTranslationGatewayBackend(options: LegitTranslationGatewayOptions): Answer {
  const facts = anthropicFactsFor(options.answeringModel)
  return (request: TransportRequest) => {
    if (routeOf(request).kind !== 'openai-chat') {
      return jsonResponse(
        404,
        openaiErrorBody({ message: 'Not found', type: 'invalid_request_error' }),
      )
    }
    const parsed = parseBody(request)
    if (parsed.kind !== 'json') {
      return rejected('Could not parse the request body as JSON')
    }
    const { value: body } = parsed
    const rejection = samplingRejection(body, facts) ?? prefillRejection(body, facts)
    if (rejection !== undefined) {
      return rejection
    }
    const prompt = openaiChatPromptText(body)
    const inputTokens = pseudoTokenCount(prompt)
    const outputTokens = pseudoTokenCount(ANSWER_TEXT)
    return jsonResponse(200, {
      ...openaiChatBody({
        id: chatCompletionId(),
        model: facts.id,
        text: ANSWER_TEXT,
        finishReason: 'stop',
        usage: { promptTokens: inputTokens, completionTokens: outputTokens },
        // Overridden below - a translation gateway never has a genuine fingerprint to report.
        systemFingerprint: null,
      }),
      // biome-ignore lint/style/useNamingConvention: wire format
      system_fingerprint: '',
    })
  }
}
