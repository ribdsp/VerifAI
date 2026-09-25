/**
 * Backend #4: `signature-forger`. A genuine Anthropic Messages endpoint for
 * the claimed model in every other respect, except it never checks a
 * replayed thinking signature against one it actually issued - the one
 * documented guarantee `thinking-signature.ts`'s veto exists to enforce.
 */

import type { Answer } from '../transport.js'
import { createAnthropicServer } from './anthropic-server.js'

export function signatureForgerBackend(answeringModel: string): Answer {
  return createAnthropicServer({
    answeringModel,
    verifiesThinkingSignatures: false,
  })
}
