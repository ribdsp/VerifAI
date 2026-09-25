/**
 * Backend #1: `thin-pass-through`. A wholly genuine endpoint for the claimed
 * model - no downgrade, no forged signature, no withheld evidence, no
 * diverted traffic. This is the false-positive test: every other backend in
 * this suite exists to prove VerifAI catches something wrong, but this one
 * exists to prove it does not cry wolf at a seller telling the truth.
 */

import type { Answer } from '../transport.js'
import { createAnthropicServer } from './anthropic-server.js'
import { createOpenaiServer } from './openai-server.js'

export function thinPassThroughBackend(claimedModel: string): Answer {
  return createAnthropicServer({
    answeringModel: claimedModel,
    verifiesThinkingSignatures: true,
  })
}

/** The OpenAI half: a wholly genuine Chat Completions/Responses endpoint for the claimed model. */
export function thinPassThroughOpenaiBackend(claimedModel: string): Answer {
  return createOpenaiServer({ answeringModel: claimedModel })
}
