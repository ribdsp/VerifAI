/**
 * What `GET /v1/models/{model_id}` answers for the claimed model. Anthropic
 * documents the object - `type: "model"`, an `id`, a `display_name`, an RFC
 * 3339 `created_at`, and `capabilities`, `max_input_tokens` and `max_tokens`
 * that may be `null` but are there - and that the endpoint resolves an alias
 * to the model ID it points at. Partner clouds name the same models their own
 * way (`anthropic.` on Bedrock, `@` before the date on Google Cloud), so an id
 * in either form speaks for a partner cloud, not for a different model.
 *
 * Nothing here moves `identity`: which id a listing reports is the platform's
 * answer, not the model's.
 */

import { type AnthropicModel, anthropicModel } from '@verifai/fingerprints'
import { modelPath } from '../../../adapters/endpoint.js'
import { isJsonObject, type JsonObject, member, readString } from '../../../adapters/json.js'
import {
  ANTHROPIC_BEDROCK_MODEL_IDS,
  ANTHROPIC_MODEL_CAPABILITIES,
  ANTHROPIC_MODEL_CREATED_AT,
  ANTHROPIC_MODEL_DISPLAY_NAME,
  ANTHROPIC_MODEL_MAX_INPUT_TOKENS,
  ANTHROPIC_MODEL_MAX_TOKENS,
  ANTHROPIC_MODEL_OBJECT_TYPE,
  ANTHROPIC_MODELS_RESOLVE_ALIAS,
  ANTHROPIC_VERTEX_DATED_IDS,
} from '../../../sources/anthropic-conformance.js'
import { isSuccess, jsonOf, quoted } from '../../shared.js'
import type { Exchange, Probe, ProbeContext, ProbeTarget, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  conformanceSignal,
  uniqueCitations,
} from './shared.js'

const ID = 'conformance/anthropic/model-retrieve'

const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const SHAPE_CITATIONS = [
  ANTHROPIC_MODEL_OBJECT_TYPE,
  ANTHROPIC_MODEL_DISPLAY_NAME,
  ANTHROPIC_MODEL_CREATED_AT,
  ANTHROPIC_MODEL_CAPABILITIES,
  ANTHROPIC_MODEL_MAX_INPUT_TOKENS,
  ANTHROPIC_MODEL_MAX_TOKENS,
] as const

const isNullableObject = (value: unknown): boolean => value === null || isJsonObject(value)
const isNullableNumber = (value: unknown): boolean => value === null || typeof value === 'number'

// biome-ignore-start lint/style/useNamingConvention: the vendors' wire names.
const NULLABLE_FIELDS: Readonly<Record<string, (value: unknown) => boolean>> = Object.freeze({
  capabilities: isNullableObject,
  max_input_tokens: isNullableNumber,
  max_tokens: isNullableNumber,
})
// biome-ignore-end lint/style/useNamingConvention: the vendors' wire names.

function shapeGaps(object: JsonObject): readonly string[] {
  const gaps: string[] = []
  if (member(object, 'type') !== 'model') {
    gaps.push('`type` is not "model"')
  }
  for (const key of ['id', 'display_name']) {
    if (readString(object, key) === undefined) {
      gaps.push(`\`${key}\` is not a string`)
    }
  }
  const createdAt = readString(object, 'created_at')
  if (createdAt === undefined || !RFC_3339.test(createdAt)) {
    gaps.push('`created_at` is not an RFC 3339 datetime')
  }
  for (const [key, accepts] of Object.entries(NULLABLE_FIELDS)) {
    if (!Object.hasOwn(object, key)) {
      gaps.push(`\`${key}\` is missing`)
    } else if (!accepts(member(object, key))) {
      gaps.push(`\`${key}\` has the wrong type`)
    }
  }
  return gaps
}

function shapeSignal(object: JsonObject): Signal {
  const gaps = shapeGaps(object)
  const conforms = gaps.length === 0
  return conformanceSignal({
    probeId: ID,
    signalId: 'model-object',
    calibration: 'documented',
    observed: conforms
      ? 'The model object has every field Anthropic documents, each of its documented type.'
      : `In the model object, ${gaps.join('; ')}.`,
    expected:
      'type "model", a string id and display_name, an RFC 3339 created_at, and capabilities, max_input_tokens and max_tokens, each present and possibly null.',
    llr: conforms
      ? { platform: { 'first-party': 0.2 } }
      : { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
    plainLanguage: conforms
      ? "The endpoint describes the model in exactly the form Anthropic's Models API uses."
      : "The endpoint describes the model in a form that differs from Anthropic's Models API.",
    citations: SHAPE_CITATIONS,
  })
}

interface IdCell {
  readonly signalId: string
  readonly asked: string
  readonly expected: string
}

function idSignal(cell: IdCell, id: string): Signal {
  const common = {
    probeId: ID,
    signalId: cell.signalId,
    observed: `Asked for ${cell.asked}, the endpoint reported the id ${quoted(id, 80)}.`,
    expected: `The id ${cell.expected}.`,
  }
  if (id === cell.expected) {
    return conformanceSignal({
      ...common,
      calibration: 'documented',
      llr: { platform: { 'first-party': 0.1 } },
      plainLanguage: `The endpoint reports the model id Anthropic's API reports for ${cell.asked}.`,
      citations: [ANTHROPIC_MODELS_RESOLVE_ALIAS],
    })
  }
  const bedrock = id.startsWith('anthropic.')
  if (bedrock || id.includes('@')) {
    return conformanceSignal({
      ...common,
      calibration: 'documented',
      llr: { platform: { 'partner-cloud': 0.4, 'first-party': -0.4 } },
      plainLanguage: `The endpoint names the model the way ${bedrock ? 'Amazon Bedrock' : 'Google Cloud'} does, not the way Anthropic's own API does.`,
      citations: [bedrock ? ANTHROPIC_BEDROCK_MODEL_IDS : ANTHROPIC_VERTEX_DATED_IDS],
    })
  }
  return conformanceSignal({
    ...common,
    calibration: 'heuristic',
    llr: { translation: { translated: 0.2 } },
    plainLanguage: `The endpoint reports a different model id from the one Anthropic's API reports for ${cell.asked}. This is how the endpoint lists the model; it says nothing about which model answers.`,
    citations: [ANTHROPIC_MODELS_RESOLVE_ALIAS],
  })
}

function unresolved(signalId: string, asked: string, exchange: Exchange): Signal {
  return conformanceSignal({
    probeId: ID,
    signalId,
    calibration: 'heuristic',
    observed: `Asked for ${asked}, the endpoint answered ${exchange.status} without a model object.`,
    expected: 'A 200 with the model object.',
    llr: { platform: { 'first-party': -0.2 } },
    plainLanguage: `The endpoint did not describe ${asked} when asked. Anthropic documents its Models API as the way to look a model up.`,
    citations: [ANTHROPIC_MODELS_RESOLVE_ALIAS, ANTHROPIC_MODEL_OBJECT_TYPE],
  })
}

function objectOf(exchange: Exchange): JsonObject | undefined {
  const body = jsonOf(exchange)
  return isSuccess(exchange) && isJsonObject(body) ? body : undefined
}

function readModel(cell: IdCell, exchange: Exchange, withShape: boolean): readonly Signal[] {
  const object = objectOf(exchange)
  if (object === undefined) {
    return [unresolved(`${cell.signalId}-unresolved`, cell.asked, exchange)]
  }
  const id = readString(object, 'id')
  return [
    ...(withShape ? [shapeSignal(object)] : []),
    ...(id === undefined ? [] : [idSignal(cell, id)]),
  ]
}

/**
 * The first alias of a pinned snapshot the buyer claimed, to check it
 * resolves. None for a model the endpoint sells under its own name, which
 * has no reason to know Anthropic's.
 */
function aliasOf(target: ProbeTarget, model: AnthropicModel | undefined): string | undefined {
  const claimed = target.claimedModel
  return model?.id === claimed && target.requestedModel === claimed
    ? model.aliases.value[0]
    : undefined
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { claimedModel: claimed, requestedModel: asked } = context.target
  const model = anthropicModel(claimed)
  const claimCell: IdCell = {
    signalId: 'claimed-id',
    asked,
    expected: model?.id ?? claimed,
  }
  const first = await context.send({ path: modelPath(asked) })
  const signals = readModel(claimCell, first, true)
  const alias = aliasOf(context.target, model)
  if (alias === undefined || objectOf(first) === undefined) {
    return Object.freeze(signals)
  }
  const second = await context.send({ path: modelPath(alias) })
  return Object.freeze([
    ...signals,
    ...readModel({ signalId: 'alias-id', asked: alias, expected: claimed }, second, false),
  ])
}

export const modelRetrieve: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Anthropic's model object and alias resolution",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  needsKey: true,
  cost: { requests: 2, tokens: 0 },
  citations: uniqueCitations([
    ...SHAPE_CITATIONS,
    ANTHROPIC_MODELS_RESOLVE_ALIAS,
    ANTHROPIC_BEDROCK_MODEL_IDS,
    ANTHROPIC_VERTEX_DATED_IDS,
  ]),
  run,
})
