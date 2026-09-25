/**
 * What the cross-vendor conformance probes share with each other and with the
 * OpenAI ones: the smallest prompt worth sending, and the out-of-range
 * temperature request that both the validator probe and OpenAI's error-wording
 * probe read, sent once per run.
 */

import { estimateTokens, generationRequest, RESPONSES_MIN_OUTPUT_TOKENS } from '../../shared.js'
import type { Exchange, ProbeContext } from '../../types.js'

export const TINY_PROMPT = 'Reply with OK.'

/** An upper bound on what one request for a single token of `TINY_PROMPT` bills, in any protocol. */
export const TINY_REQUEST_TOKENS = estimateTokens(TINY_PROMPT) + RESPONSES_MIN_OUTPUT_TOKENS

/** Above the documented maximum of both vendors: 1 for Anthropic, 2 for OpenAI. */
export const OUT_OF_RANGE_TEMPERATURE = 99

/** One token asked for at `OUT_OF_RANGE_TEMPERATURE`, in the target's protocol. */
export function outOfRangeTemperature(context: ProbeContext): Promise<Exchange> {
  return context.shared('conformance/common/temperature-out-of-range', () =>
    context.send(
      generationRequest(context.target, {
        prompt: TINY_PROMPT,
        maxTokens: 1,
        extra: { temperature: OUT_OF_RANGE_TEMPERATURE },
      }),
    ),
  )
}
