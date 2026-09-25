/**
 * Which combinations of reasoning effort and sampling the endpoint refuses.
 * OpenAI documents, model by model, whether effort `none` is taken, and whether
 * a sampling field such as `temperature` raises an error at `none` or at any
 * other effort: GPT-5.2 and GPT-5.1 take sampling fields only at `none`, the
 * older GPT-5 models at no effort, and GPT-6 Astra takes no `none` at all. The
 * refusal is the model's, so it speaks on `identity`; a layer that drops the
 * fields changes it too, which the shared matrix reading reports on
 * `translation`.
 *
 * A control goes first: effort `low` alone, which the claimed model's page
 * lists. An endpoint that does not answer it is not answering the question the
 * cells ask, so the cells are not sent.
 */

import {
  OPENAI_MODELS,
  type OpenAIModel,
  type OpenAIReasoningEffort,
  openaiModel,
} from '@verifai/fingerprints'
import { estimateTokens, RESPONSES_MIN_OUTPUT_TOKENS } from '../../shared.js'
import type { Probe, ProbeContext, ProbeRequest, ProbeTarget, Signal } from '../../types.js'
import { type MatrixControl, PROMPT, refusableRequest, uniqueCitations } from '../shared.js'
import { documentsAny, OPENAI_PROTOCOLS, type RejectionCell, runMatrix } from './shared.js'

const ID = 'conformance/openai/reasoning-matrix'

/**
 * The fewest output tokens the Responses API takes. Chat Completions is asked
 * for as many, so the two protocols' requests differ only in field names.
 */
const OUTPUT_TOKENS = RESPONSES_MIN_OUTPUT_TOKENS

const CONTROL_EFFORT: OpenAIReasoningEffort = 'low'
const TEMPERATURE = 0.5

interface Combination {
  readonly effort: OpenAIReasoningEffort
  readonly sampling: boolean
  readonly rejects: RejectionCell['rejects']
}

const COMBINATIONS: readonly Combination[] = Object.freeze([
  { effort: 'none', sampling: false, rejects: (model) => model.rejectsNoneEffort },
  { effort: 'none', sampling: true, rejects: (model) => model.rejectsSamplingAtNoneEffort },
  { effort: 'low', sampling: true, rejects: (model) => model.rejectsSamplingAtOtherEffort },
])

const REQUESTS = 1 + COMBINATIONS.length

interface Shape {
  readonly sends: string
  readonly request: ProbeRequest
}

/** `effort`, and `temperature` when `sampling`, in the target's protocol. */
function shape(target: ProbeTarget, effort: OpenAIReasoningEffort, sampling: boolean): Shape {
  const responses = target.protocol === 'openai-responses'
  // biome-ignore lint/style/useNamingConvention: the vendor's wire name.
  const field = responses ? { reasoning: { effort } } : { reasoning_effort: effort }
  const extra = sampling ? { ...field, temperature: TEMPERATURE } : field
  const sends = [
    `${responses ? 'reasoning.effort' : 'reasoning_effort'}: ${effort}`,
    ...(sampling ? [`temperature: ${TEMPERATURE}`] : []),
  ].join(', ')
  return { sends, request: refusableRequest(target, extra, OUTPUT_TOKENS) }
}

function cells(target: ProbeTarget): readonly RejectionCell[] {
  return Object.freeze(
    COMBINATIONS.map(({ effort, sampling, rejects }) =>
      Object.freeze({ ...shape(target, effort, sampling), rejects, messages: [] }),
    ),
  )
}

function control(target: ProbeTarget, model: OpenAIModel): MatrixControl {
  const { sends, request } = shape(target, CONTROL_EFFORT, false)
  return Object.freeze({
    sends,
    request,
    expected: `${sends} is accepted: OpenAI lists ${CONTROL_EFFORT} among ${model.id}'s reasoning efforts.`,
    plainLanguage: `The endpoint refused reasoning effort ${CONTROL_EFFORT}, which OpenAI documents ${model.id} takes.`,
    citations: model.reasoningEfforts.sources,
  })
}

function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { target } = context
  return runMatrix(context, ID, cells(target), (model) => control(target, model))
}

const documentsACell = documentsAny(COMBINATIONS.map(({ rejects }) => rejects))

/** A model the docs settle a cell for, and whose page lists the control's effort. */
function applies(target: ProbeTarget): boolean {
  const efforts = openaiModel(target.claimedModel)?.reasoningEfforts.value ?? []
  return efforts.includes(CONTROL_EFFORT) && documentsACell(target)
}

export const reasoningMatrix: Probe = Object.freeze<Probe>({
  id: ID,
  title: "GPT models' documented reasoning-effort and sampling refusals",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  applies,
  needsKey: true,
  cost: { requests: REQUESTS, tokens: REQUESTS * (estimateTokens(PROMPT) + OUTPUT_TOKENS) },
  citations: uniqueCitations(
    OPENAI_MODELS.flatMap((model) =>
      COMBINATIONS.flatMap(({ rejects }) => rejects(model)?.sources ?? []),
    ),
  ),
  run,
})
