/**
 * Whether the endpoint refuses forced tool use - `tool_choice` of type `any`.
 * Anthropic documents which Claude models refuse it with a 400 (Opus 5.5,
 * Fable 5.1, Mythos 5.1) and which take it, and the wording of the refusal.
 * The refusal is the model's, so it speaks on `identity`.
 */

import { ANTHROPIC_REJECTIONS, type AnthropicModel } from '@verifai/fingerprints'
import type { Probe, ProbeContext, ProbeTarget, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  CELL_TOKENS,
  documentsAny,
  type RejectionCell,
  refusableRequest,
  runMatrix,
} from './shared.js'

const ID = 'conformance/anthropic/forced-tool-choice'

/** A tool with nothing behind it: the request is refused or cut off before any call. */
// biome-ignore-start lint/style/useNamingConvention: the vendor's wire names.
const TOOL = Object.freeze({
  name: 'record_word',
  description: 'Records one word.',
  input_schema: {
    type: 'object',
    properties: { word: { type: 'string' } },
    required: ['word'],
  },
})
// biome-ignore-end lint/style/useNamingConvention: the vendor's wire names.

/** Tool use adds a system prompt of a few hundred tokens of its own; this bounds it. */
const TOOL_PROMPT_TOKENS = 512
/** The schema and that prompt travel with the request, so they count toward what it may bill. */
const TOOL_TOKENS =
  CELL_TOKENS + new TextEncoder().encode(JSON.stringify(TOOL)).length + TOOL_PROMPT_TOKENS

const rejectsForcedToolChoice = (model: AnthropicModel) => model.rejectsForcedToolChoice

function cells(target: ProbeTarget): readonly RejectionCell[] {
  return Object.freeze([
    Object.freeze({
      sends: 'tool_choice {"type": "any"}',
      request: {
        ...refusableRequest(target, {
          tools: [TOOL],
          // biome-ignore lint/style/useNamingConvention: the vendor's wire name.
          tool_choice: { type: 'any' },
        }),
        tokens: TOOL_TOKENS,
      },
      rejects: rejectsForcedToolChoice,
      messages: [ANTHROPIC_REJECTIONS.forcedToolChoice],
    }),
  ])
}

function run(context: ProbeContext): Promise<readonly Signal[]> {
  return runMatrix(context, ID, cells(context.target))
}

export const forcedToolChoice: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Claude models' documented forced-tool-use refusals",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  applies: documentsAny([rejectsForcedToolChoice]),
  needsKey: true,
  cost: { requests: 1, tokens: TOOL_TOKENS },
  citations: ANTHROPIC_REJECTIONS.forcedToolChoice.sources,
  run,
})
