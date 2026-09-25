/**
 * Which `thinking` modes the endpoint refuses. Anthropic documents, model by
 * model, whether `enabled` (with a budget), `adaptive` and `disabled` come
 * back as a 400, and the wording of each refusal: models whose thinking is
 * always on refuse `enabled` and `disabled`, the 4.5 generation refuses
 * `adaptive`. The refusal is the model's, so it speaks on `identity`.
 *
 * Only the modes the docs settle for the claimed model are sent.
 */

import { ANTHROPIC_REJECTIONS, type AnthropicModel } from '@verifai/fingerprints'
import { estimateTokens } from '../../shared.js'
import type { Probe, ProbeContext, ProbeTarget, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  CELL_TOKENS,
  documentsAny,
  PROMPT,
  type RejectionCell,
  refusableRequest,
  runMatrix,
  uniqueCitations,
} from './shared.js'

const ID = 'conformance/anthropic/thinking-matrix'

/** The smallest budget Anthropic takes; `max_tokens` must exceed it. */
const BUDGET_TOKENS = 1024
/** Room for a model that does think to answer at all. */
const THINKING_MAX_TOKENS = BUDGET_TOKENS + 1
const THINKING_TOKENS = estimateTokens(PROMPT) + THINKING_MAX_TOKENS

const rejectsEnabled = (model: AnthropicModel) => model.rejectsThinkingEnabled
const rejectsAdaptive = (model: AnthropicModel) => model.rejectsThinkingAdaptive
const rejectsDisabled = (model: AnthropicModel) => model.rejectsThinkingDisabled

function cells(target: ProbeTarget): readonly RejectionCell[] {
  return Object.freeze([
    Object.freeze({
      sends: `thinking enabled with a ${BUDGET_TOKENS}-token budget`,
      request: refusableRequest(
        target,
        // biome-ignore lint/style/useNamingConvention: the vendor's wire name.
        { thinking: { type: 'enabled', budget_tokens: BUDGET_TOKENS } },
        THINKING_MAX_TOKENS,
      ),
      rejects: rejectsEnabled,
      messages: [ANTHROPIC_REJECTIONS.thinkingEnabled],
    }),
    Object.freeze({
      sends: 'adaptive thinking',
      request: refusableRequest(target, { thinking: { type: 'adaptive' } }, THINKING_MAX_TOKENS),
      rejects: rejectsAdaptive,
      messages: [ANTHROPIC_REJECTIONS.thinkingAdaptive],
    }),
    Object.freeze({
      sends: 'thinking disabled',
      request: refusableRequest(target, { thinking: { type: 'disabled' } }),
      rejects: rejectsDisabled,
      messages: [
        ANTHROPIC_REJECTIONS.thinkingDisabled,
        ANTHROPIC_REJECTIONS.thinkingDisabledMythosPreview,
      ],
    }),
  ])
}

function run(context: ProbeContext): Promise<readonly Signal[]> {
  return runMatrix(context, ID, cells(context.target))
}

export const thinkingMatrix: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Claude models' documented thinking-mode refusals",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  applies: documentsAny([rejectsEnabled, rejectsAdaptive, rejectsDisabled]),
  needsKey: true,
  cost: { requests: 3, tokens: 2 * THINKING_TOKENS + CELL_TOKENS },
  citations: uniqueCitations([
    ...ANTHROPIC_REJECTIONS.thinkingEnabled.sources,
    ...ANTHROPIC_REJECTIONS.thinkingAdaptive.sources,
    ...ANTHROPIC_REJECTIONS.thinkingDisabled.sources,
    ...ANTHROPIC_REJECTIONS.thinkingDisabledMythosPreview.sources,
  ]),
  run,
})
