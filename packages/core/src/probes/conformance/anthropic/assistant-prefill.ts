/**
 * Whether the endpoint refuses a conversation that ends in an assistant
 * message - a prefill. Anthropic documents which Claude models refuse one with
 * a 400 (4.6 and later, and Claude Mythos Preview) and which take it, and the
 * wording of the refusal. The refusal is the model's, so it speaks on
 * `identity`; how it is worded speaks on the layer in front of it.
 */

import { ANTHROPIC_REJECTIONS, type AnthropicModel } from '@verifai/fingerprints'
import { estimateTokens } from '../../shared.js'
import type { Probe, ProbeContext, ProbeTarget, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  documentsAny,
  PROMPT,
  type RejectionCell,
  refusableRequest,
  runMatrix,
} from './shared.js'

const ID = 'conformance/anthropic/assistant-prefill'

const PREFILL = 'o'

const rejectsPrefill = (model: AnthropicModel) => model.rejectsPrefill

function cells(target: ProbeTarget): readonly RejectionCell[] {
  return Object.freeze([
    Object.freeze({
      sends: `an assistant prefill ("${PREFILL}")`,
      request: refusableRequest(target, {
        messages: [
          { role: 'user', content: PROMPT },
          { role: 'assistant', content: PREFILL },
        ],
      }),
      rejects: rejectsPrefill,
      messages: [ANTHROPIC_REJECTIONS.prefill],
    }),
  ])
}

function run(context: ProbeContext): Promise<readonly Signal[]> {
  return runMatrix(context, ID, cells(context.target))
}

export const assistantPrefill: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Claude models' documented prefill refusals",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  applies: documentsAny([rejectsPrefill]),
  needsKey: true,
  cost: { requests: 1, tokens: estimateTokens(PROMPT + PREFILL) + 1 },
  citations: ANTHROPIC_REJECTIONS.prefill.sources,
  run,
})
