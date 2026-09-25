/**
 * Mutable state one fake Anthropic backend keeps across requests: its prompt
 * cache, and which thinking signatures it has itself issued. Each backend
 * instance owns one of these; nothing in `anthropic-core.ts` is stateful on
 * its own.
 */

export interface AnthropicState {
  /** Cached prompt text to the tokens it was written with. Exact-prefix, like Anthropic's. */
  readonly cache: Map<string, number>
  /** Signatures this backend has issued on a thinking block, for replay verification. */
  readonly signatures: Set<string>
}

export function createAnthropicState(): AnthropicState {
  return { cache: new Map(), signatures: new Set() }
}

let signatureCounter = 0

/** A signature unique enough that two backends never collide on one by chance. */
export function issueSignature(state: AnthropicState): string {
  signatureCounter += 1
  const signature = `sig${signatureCounter}${Math.random().toString(36).slice(2)}`
  state.signatures.add(signature)
  return signature
}
