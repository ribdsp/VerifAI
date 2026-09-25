/**
 * What OpenAI documents about each reasoning model whose effort and sampling
 * rules its guides settle: the snapshot it resolves to, what it costs, which
 * `reasoning.effort` values it takes, and which combinations of effort and
 * sampling fields it rejects. A probe that sends those combinations can tell a
 * claimed model from a substitute by which ones are refused.
 *
 * A field is `undefined` wherever the docs do not settle it. That is not the
 * same as `false`: a probe must not treat a silence in the docs as evidence.
 * The GPT-6 guide only advises removing sampling fields at an effort other
 * than `none`, without saying a request that keeps them fails, so no GPT-6
 * model has a sampling fact.
 */

import type { PerMillionTokens } from './lookup.js'
import {
  defaultSnapshotSource,
  EFFORT_LINES,
  GPT_5_FAMILY,
  NONE_EFFORT,
  priceColumnsSource,
  priceSource,
  SAMPLING_BY_EFFORT,
} from './openai-sources.js'
import { documented, type Fact, type FactSource, type Sources } from './source.js'

export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Base prices in USD per million tokens, before caching or batch discounts. */
export type OpenAIPricing = PerMillionTokens

/**
 * An effort is sent as `reasoning_effort` on Chat Completions and as
 * `reasoning.effort` on Responses. The sampling fields are `temperature`,
 * `top_p` and `logprobs`. Every `rejects*` field is about an error, not a
 * silent ignore.
 */
export interface OpenAIModel {
  /** The value sent as `model`, and the ID of the model's page. */
  readonly id: string
  readonly displayName: string
  /** Other `model` values that resolve to this model: its default snapshot, when that is not `id`. */
  readonly snapshots: Fact<readonly string[]>
  readonly pricing: Fact<OpenAIPricing> | undefined
  readonly reasoningEfforts: Fact<readonly OpenAIReasoningEffort[]>
  readonly defaultReasoningEffort: Fact<OpenAIReasoningEffort> | undefined
  /** Effort `none` is rejected. */
  readonly rejectsNoneEffort: Fact<boolean> | undefined
  /** A sampling field is rejected at effort `none`. */
  readonly rejectsSamplingAtNoneEffort: Fact<boolean> | undefined
  /** A sampling field is rejected at any effort other than `none`. */
  readonly rejectsSamplingAtOtherEffort: Fact<boolean> | undefined
}

const yes = (sources: Sources, note?: string): Fact<boolean> => documented(true, sources, note)
const no = (sources: Sources, note?: string): Fact<boolean> => documented(false, sources, note)

function price(id: string, input: number, output: number): Fact<OpenAIPricing> {
  return documented<OpenAIPricing>({ inputPerMTok: input, outputPerMTok: output }, [
    priceSource(id, 'Input', String(input)),
    priceSource(id, 'Output', String(output)),
    priceColumnsSource(id),
  ])
}

function efforts(
  values: readonly OpenAIReasoningEffort[],
  sources: Sources,
): Fact<readonly OpenAIReasoningEffort[]> {
  return documented<readonly OpenAIReasoningEffort[]>([...values], sources)
}

const effort = (value: OpenAIReasoningEffort, line: FactSource): Fact<OpenAIReasoningEffort> =>
  documented(value, [line])

const GPT_5_EFFORTS = efforts(
  ['minimal', 'low', 'medium', 'high'],
  [GPT_5_FAMILY.efforts, GPT_5_FAMILY.members],
)
const GPT_6_EFFORTS: readonly OpenAIReasoningEffort[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

const SAMPLING_REJECTED_AT_ANY_EFFORT = yes([
  SAMPLING_BY_EFFORT.otherwiseError,
  GPT_5_FAMILY.members,
])
const SAMPLING_REJECTED_AT_NONE_EFFORT = yes(
  [SAMPLING_BY_EFFORT.otherwiseError, GPT_5_FAMILY.members],
  'The GPT-5 family lists no `none` effort, so such a request may be refused for the effort alone.',
)
const SAMPLING_ONLY_AT_NONE = yes([
  SAMPLING_BY_EFFORT.otherwiseError,
  SAMPLING_BY_EFFORT.onlyAtNone,
])

type Spec = Pick<OpenAIModel, 'id' | 'displayName' | 'reasoningEfforts'> &
  Partial<Omit<OpenAIModel, 'id' | 'displayName' | 'reasoningEfforts' | 'snapshots'>> & {
    readonly snapshot?: string
  }

/** Fills in the snapshot fact, and every field the spec leaves out as `undefined`. */
function define(spec: Spec): OpenAIModel {
  const { snapshot, id, displayName, reasoningEfforts, ...fields } = spec
  return Object.freeze({
    id,
    displayName,
    snapshots:
      snapshot === undefined
        ? documented<readonly string[]>(
            [],
            [defaultSnapshotSource(id, id)],
            'The default snapshot is the model ID itself.',
          )
        : documented<readonly string[]>([snapshot], [defaultSnapshotSource(id, snapshot)]),
    pricing: undefined,
    reasoningEfforts,
    defaultReasoningEffort: undefined,
    rejectsNoneEffort: undefined,
    rejectsSamplingAtNoneEffort: undefined,
    rejectsSamplingAtOtherEffort: undefined,
    ...fields,
  })
}

/** GPT-6 first, then GPT-5 by release, as the model guides order them. */
export const OPENAI_MODELS: readonly OpenAIModel[] = Object.freeze([
  define({
    id: 'gpt-6-astra',
    displayName: 'GPT-6 Astra',
    pricing: price('gpt-6-astra', 10, 50),
    reasoningEfforts: efforts(['low', 'medium', 'high', 'xhigh', 'max'], [EFFORT_LINES.astra]),
    rejectsNoneEffort: yes([NONE_EFFORT.astraRejected, NONE_EFFORT.gpt6Limitation]),
  }),
  define({
    id: 'gpt-6-sol',
    displayName: 'GPT-6 Sol',
    pricing: price('gpt-6-sol', 2, 10),
    reasoningEfforts: efforts(GPT_6_EFFORTS, [EFFORT_LINES.sol]),
    defaultReasoningEffort: effort('medium', EFFORT_LINES.sol),
    rejectsNoneEffort: no([EFFORT_LINES.sol, NONE_EFFORT.gpt6Limitation]),
  }),
  define({
    id: 'gpt-6-luna',
    displayName: 'GPT-6 Luna',
    pricing: price('gpt-6-luna', 0.1, 0.5),
    reasoningEfforts: efforts(GPT_6_EFFORTS, [EFFORT_LINES.luna]),
    defaultReasoningEffort: effort('medium', EFFORT_LINES.luna),
    rejectsNoneEffort: no([EFFORT_LINES.luna, NONE_EFFORT.gpt6Limitation]),
  }),
  define({
    id: 'gpt-5.2',
    displayName: 'GPT-5.2',
    snapshot: 'gpt-5.2-2025-12-11',
    pricing: price('gpt-5.2', 1.75, 14),
    reasoningEfforts: efforts(['none', 'low', 'medium', 'high', 'xhigh'], [EFFORT_LINES.gpt52]),
    defaultReasoningEffort: effort('none', EFFORT_LINES.gpt52),
    rejectsNoneEffort: no([EFFORT_LINES.gpt52]),
    rejectsSamplingAtNoneEffort: no([SAMPLING_BY_EFFORT.onlyAtNone, SAMPLING_BY_EFFORT.parameters]),
    rejectsSamplingAtOtherEffort: SAMPLING_ONLY_AT_NONE,
  }),
  define({
    id: 'gpt-5.1',
    displayName: 'GPT-5.1',
    snapshot: 'gpt-5.1-2025-11-13',
    pricing: price('gpt-5.1', 1.25, 10),
    reasoningEfforts: efforts(['none', 'low', 'medium', 'high'], [EFFORT_LINES.gpt51]),
    defaultReasoningEffort: effort('none', EFFORT_LINES.gpt51),
    rejectsNoneEffort: no([EFFORT_LINES.gpt51]),
    rejectsSamplingAtNoneEffort: no(
      [SAMPLING_BY_EFFORT.otherwiseError, SAMPLING_BY_EFFORT.parameters],
      'The error sentence names GPT-5.1 only at a reasoning effort other than `none`.',
    ),
    rejectsSamplingAtOtherEffort: SAMPLING_ONLY_AT_NONE,
  }),
  define({
    id: 'gpt-5',
    displayName: 'GPT-5',
    snapshot: 'gpt-5-2025-08-07',
    pricing: price('gpt-5', 1.25, 10),
    reasoningEfforts: efforts(['minimal', 'low', 'medium', 'high'], [EFFORT_LINES.gpt5]),
    rejectsSamplingAtNoneEffort: SAMPLING_REJECTED_AT_NONE_EFFORT,
    rejectsSamplingAtOtherEffort: SAMPLING_REJECTED_AT_ANY_EFFORT,
  }),
  define({
    id: 'gpt-5-mini',
    displayName: 'GPT-5 Mini',
    snapshot: 'gpt-5-mini-2025-08-07',
    pricing: price('gpt-5-mini', 0.25, 2),
    reasoningEfforts: GPT_5_EFFORTS,
    rejectsSamplingAtNoneEffort: SAMPLING_REJECTED_AT_NONE_EFFORT,
    rejectsSamplingAtOtherEffort: SAMPLING_REJECTED_AT_ANY_EFFORT,
  }),
  define({
    id: 'gpt-5-nano',
    displayName: 'GPT-5 nano',
    snapshot: 'gpt-5-nano-2025-08-07',
    pricing: price('gpt-5-nano', 0.05, 0.4),
    reasoningEfforts: GPT_5_EFFORTS,
    rejectsSamplingAtNoneEffort: SAMPLING_REJECTED_AT_NONE_EFFORT,
    rejectsSamplingAtOtherEffort: SAMPLING_REJECTED_AT_ANY_EFFORT,
  }),
])
