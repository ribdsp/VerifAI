/**
 * Which sampling settings the endpoint refuses. Anthropic documents, model by
 * model, whether a non-default `temperature`, `top_p` or `top_k` comes back as
 * a 400: Claude models released after Opus 4.6 refuse all three, earlier ones
 * take them. The refusal is the model's, so it speaks on `identity`; a layer
 * that drops the fields changes it too, which the shared matrix reading
 * reports on `translation`.
 *
 * A control goes first: `temperature: 1`, which Anthropic documents every
 * restricted model still accepts. An endpoint that does not answer it is not
 * answering the question the cells ask, so the cells are not sent.
 */

import {
  ANTHROPIC_SAMPLING_COMPATIBILITY,
  type AnthropicModel,
  anthropicModel,
} from '@verifai/fingerprints'
import type { Probe, ProbeContext, ProbeTarget, Signal } from '../../types.js'
import type { MatrixControl } from '../shared.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  CELL_TOKENS,
  type RejectionCell,
  refusableRequest,
  runMatrix,
} from './shared.js'

const ID = 'conformance/anthropic/sampling-matrix'

type Setting = Readonly<Record<string, number>>

// biome-ignore-start lint/style/useNamingConvention: the vendors' wire names.
const SETTINGS: readonly Setting[] = Object.freeze([
  { temperature: 0.5 },
  { top_p: 0.5 },
  { top_k: 5 },
])
// biome-ignore-end lint/style/useNamingConvention: the vendors' wire names.

const CONTROL: Setting = Object.freeze({
  temperature: ANTHROPIC_SAMPLING_COMPATIBILITY.value.acceptedTemperature,
})

const REQUESTS = 1 + SETTINGS.length

const sendsOf = (setting: Setting): string =>
  Object.entries(setting)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')

const rejectsSampling = (model: AnthropicModel) => model.rejectsSamplingParameters

function cells(target: ProbeTarget): readonly RejectionCell[] {
  return Object.freeze(
    SETTINGS.map((setting) =>
      Object.freeze({
        sends: sendsOf(setting),
        request: refusableRequest(target, setting),
        rejects: rejectsSampling,
        messages: [],
      }),
    ),
  )
}

function control(target: ProbeTarget): MatrixControl {
  const sends = sendsOf(CONTROL)
  return Object.freeze({
    sends,
    request: refusableRequest(target, CONTROL),
    expected: `${sends} is accepted, by restricted models included.`,
    plainLanguage:
      'The endpoint refused temperature 1, a value Anthropic documents every Claude model accepts.',
    citations: ANTHROPIC_SAMPLING_COMPATIBILITY.sources,
  })
}

function run(context: ProbeContext): Promise<readonly Signal[]> {
  return runMatrix(context, ID, cells(context.target), () => control(context.target))
}

export const samplingMatrix: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Claude models' documented sampling-parameter refusals",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  applies: (target) => anthropicModel(target.claimedModel)?.rejectsSamplingParameters !== undefined,
  needsKey: true,
  cost: { requests: REQUESTS, tokens: REQUESTS * CELL_TOKENS },
  citations: ANTHROPIC_SAMPLING_COMPATIBILITY.sources,
  run,
})
