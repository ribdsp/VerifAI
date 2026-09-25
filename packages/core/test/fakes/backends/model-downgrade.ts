/**
 * Backend #3: `model-downgrade`. A cheaper Anthropic model answers every
 * request while the endpoint claims to be the model it names - the same
 * genuine Anthropic Messages behaviour as a faithful backend, just built from
 * a different model's documented facts. `same-vendor-cheaper` exists to catch
 * exactly this: real Anthropic conformance, wrong model underneath.
 *
 * The OpenAI half goes one step further, as a seller hiding a cheaper GPT
 * model would: every answer and its model list report the model it sells, so
 * only what the answering model does can give it away.
 */

import type { Answer } from '../transport.js'
import { createAnthropicServer } from './anthropic-server.js'
import { createOpenaiServer } from './openai-server.js'

/** The model this backend truly answers as, regardless of what the target claims. */
export const DOWNGRADE_ANSWERING_MODEL = 'claude-haiku-4-5-20251001'

export function modelDowngradeBackend(): Answer {
  return createAnthropicServer({
    answeringModel: DOWNGRADE_ANSWERING_MODEL,
    verifiesThinkingSignatures: true,
  })
}

/** The GPT model the OpenAI half truly answers as: an older GPT-5 model, cheaper than GPT-5.2. */
export const OPENAI_DOWNGRADE_ANSWERING_MODEL = 'gpt-5-mini-2025-08-07'

export function openaiModelDowngradeBackend(soldModel: string): Answer {
  return createOpenaiServer({
    answeringModel: OPENAI_DOWNGRADE_ANSWERING_MODEL,
    reportedModel: soldModel,
  })
}
