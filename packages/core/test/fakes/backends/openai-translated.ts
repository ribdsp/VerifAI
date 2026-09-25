/**
 * Backend #2: `openai-translated`. A GPT model answers every request, but a
 * gateway in front of it reshapes the wire into Anthropic's Messages format
 * and echoes back whatever model name the request claims - the deception is
 * only skin-deep. What a thin reshaping cannot fake is underneath: GPT's own
 * tokenizer counts, a hard `max_tokens` ceiling with no notion of Claude's
 * own thinking budget, no support for a `thinking` block, and none of the
 * rejections a genuine Claude model gives for its own sampling, prefill or
 * forced-tool-choice quirks, because those quirks belong to Claude, not GPT.
 *
 * A gateway built only to reshape generation calls has no reason to also
 * build Anthropic's free, ancillary counting endpoint, so
 * `/v1/messages/count_tokens` is left unanswered rather than reimplemented
 * on GPT's tokenizer - the same gap a genuine first-party endpoint would
 * never have.
 *
 * Anthropic's Messages API is `native` for anything that claims `anthropic`
 * over `anthropic-messages`, so this target is held to Claude's full
 * conformance catalogue - which a translated GPT backend cannot pass.
 */

import type { TransportRequest, TransportResponse } from '../../../src/transport/types.js'
import type { Answer } from '../transport.js'
import { response } from '../transport.js'
import { openaiFactsFor } from './model-facts.js'
import {
  anthropicErrorBody,
  anthropicMessageBody,
  anthropicMessageId,
  anthropicPromptText,
  type JsonObject,
  openaiTokenCount,
  parseBody,
  routeOf,
} from './shared.js'

export interface OpenaiTranslatedOptions {
  /** The Anthropic model name the gateway claims to be. */
  readonly claimedModel: string
  /** The GPT model that genuinely answers underneath. */
  readonly answeringModel: string
}

const ANSWER_TEXT = 'ok'

function jsonResponse(status: number, body: JsonObject): TransportResponse {
  return response(status, JSON.stringify(body), [['Content-Type', 'application/json']])
}

function rejected(message: string): TransportResponse {
  return jsonResponse(400, anthropicErrorBody('invalid_request_error', message))
}

/** A thin reshaping gateway only wires up the one route a Messages client needs to generate. */
export function openaiTranslatedBackend(options: OpenaiTranslatedOptions): Answer {
  const facts = openaiFactsFor(options.answeringModel)
  return async (request: TransportRequest) => {
    const route = routeOf(request)
    if (route.kind !== 'anthropic-messages') {
      return jsonResponse(404, anthropicErrorBody('not_found_error', 'Not found'))
    }
    const parsed = parseBody(request)
    if (parsed.kind !== 'json') {
      return rejected('Could not parse the request body as JSON')
    }
    if (typeof parsed.value.max_tokens !== 'number') {
      return rejected('max_tokens: Field required')
    }
    const prompt = anthropicPromptText(parsed.value)
    const [inputTokens, desiredOutputTokens] = await Promise.all([
      openaiTokenCount(facts.id, prompt),
      openaiTokenCount(facts.id, ANSWER_TEXT),
    ])
    const ceiling = parsed.value.max_tokens
    const outputTokens = Math.min(desiredOutputTokens, ceiling)
    const stopReason = outputTokens === ceiling ? 'max_tokens' : 'end_turn'
    return jsonResponse(
      200,
      anthropicMessageBody({
        id: anthropicMessageId(),
        model: options.claimedModel,
        text: ANSWER_TEXT,
        stopReason,
        usage: { inputTokens, outputTokens },
      }),
    )
  }
}
