/**
 * Lookups over the Anthropic model catalog, plus the error texts a rejected
 * request comes back with. The per-model facts live in `anthropic-models.ts`.
 */

import { ANTHROPIC_MODELS, type AnthropicModel } from './anthropic-models.js'
import { FORCED_TOOL, PREFILL, SAMPLING, THINKING, THINKING_MESSAGES } from './anthropic-sources.js'
import { cheaperThan, indexByName } from './lookup.js'
import { documented, type Fact, type FactSource } from './source.js'

export {
  ANTHROPIC_MODELS,
  type AnthropicFamily,
  type AnthropicModel,
  type AnthropicPricing,
  type AnthropicTokenizer,
} from './anthropic-models.js'

/** The body of a documented 400, so a probe can tell the real rejection from a proxy's own. */
export interface AnthropicRejection {
  readonly status: 400
  readonly errorType: 'invalid_request_error'
  readonly message: string
}

function rejection(
  message: FactSource,
  status: FactSource,
  note?: string,
): Fact<AnthropicRejection> {
  return documented<AnthropicRejection>(
    { status: 400, errorType: 'invalid_request_error', message: message.quote },
    [message, status],
    note,
  )
}

export const ANTHROPIC_REJECTIONS = Object.freeze({
  prefill: rejection(PREFILL.message, PREFILL.status),
  thinkingEnabled: rejection(THINKING_MESSAGES.enabled, THINKING.enabledStatus),
  thinkingAdaptive: rejection(THINKING_MESSAGES.adaptive, THINKING.adaptiveRejectedTo45),
  thinkingDisabled: rejection(
    THINKING_MESSAGES.disabled,
    THINKING.alwaysOn,
    'Every always-on model except Claude Mythos Preview.',
  ),
  thinkingDisabledMythosPreview: rejection(
    THINKING_MESSAGES.disabledMythosPreview,
    THINKING.alwaysOn,
  ),
  forcedToolChoice: rejection(FORCED_TOOL.message, FORCED_TOOL.status),
})

/** Sampling values that restricted models still accept, for probes that must not trip the 400. */
export interface AnthropicSamplingCompatibility {
  readonly acceptedTemperature: number
  readonly minimumAcceptedTopP: number
  readonly acceptsTopK: boolean
}

export const ANTHROPIC_SAMPLING_COMPATIBILITY: Fact<AnthropicSamplingCompatibility> = documented(
  { acceptedTemperature: 1, minimumAcceptedTopP: 0.99, acceptsTopK: false },
  [SAMPLING.afterOpus46, SAMPLING.topPCompatibility, SAMPLING.topKNever],
  'From the Messages API reference. The migration guides say any non-default value returns a 400, so these may not hold on every restricted model.',
)

const BY_ID: ReadonlyMap<string, AnthropicModel> = indexByName(
  'Anthropic',
  ANTHROPIC_MODELS,
  (model) => model.aliases.value,
)

/** The model a `model` value names, by ID or alias; `undefined` if the docs list no such value. */
export function anthropicModel(id: string): AnthropicModel | undefined {
  return BY_ID.get(id)
}

/**
 * Priced models that are at least as cheap on input and output and strictly
 * cheaper on one: the substitutes a reseller billing for `id` would gain by
 * serving instead. Cheapest first. Empty if `id` is unknown or unpriced.
 */
export function cheaperAnthropicModels(id: string): readonly AnthropicModel[] {
  return cheaperThan(ANTHROPIC_MODELS, anthropicModel(id))
}
