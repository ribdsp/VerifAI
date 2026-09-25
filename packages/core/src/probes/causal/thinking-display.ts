/**
 * Whether thinking text comes back when the request does not ask for it.
 * Anthropic documents `thinking.display` per model: newer models return an
 * empty `thinking` field unless the caller opts in, their predecessors return
 * summarized text. The request this probe reads sets no `display`, so the
 * default is the backend's own.
 *
 * Text where the claimed model returns none, or none where it returns text, is
 * the default of another model or a layer that set `display` on the way. When
 * a cheaper Anthropic model has the default that was seen, that is said too.
 */

import { cheaperAnthropicModels } from '@verifai/fingerprints'
import { ProbeNotApplicable } from '../../runner/errors.js'
import {
  ANTHROPIC_DISPLAY_OMITTED_FABLE_51,
  ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47,
  ANTHROPIC_DISPLAY_OMITTED_OPUS_55,
  ANTHROPIC_DISPLAY_OMITTED_SONNET_5,
} from '../../sources/anthropic-causal.js'
import { isSuccess } from '../shared.js'
import type { Probe, ProbeContext, ProbeTarget, Signal } from '../types.js'
import {
  causalSignal,
  claimedAnthropic,
  type DisplayDefault,
  displayDefault,
  SEED_TOKENS,
  type ThinkingDisplay,
  thinkingConfig,
  thinkingSeed,
} from './shared.js'

const ID = 'causal/thinking-display'

/** Whether a model cheaper than `model` defaults to `display`. */
function cheaperDefaultsTo(model: string, display: ThinkingDisplay): boolean {
  return cheaperAnthropicModels(model).some((cheaper) => displayDefault(cheaper)?.value === display)
}

function mismatch(
  model: string,
  claimed: DisplayDefault,
  seen: ThinkingDisplay,
  observed: string,
): Signal {
  const cheaper = cheaperDefaultsTo(model, seen)
  const isText = seen === 'summarized'
  return causalSignal(ID, {
    signalId: isText ? 'text-by-default' : 'empty-by-default',
    calibration: 'documented',
    observed,
    expected: `With no display set, ${model} defaults to "${claimed.value}".`,
    llr: {
      identity: {
        'matches-claim': -0.5,
        ...(cheaper ? { 'same-vendor-cheaper': 0.3 } : {}),
      },
      translation: { translated: isText ? 0.4 : 0.3 },
    },
    plainLanguage: `The request did not say whether to show thinking, and the thinking came back ${isText ? 'with text' : 'empty'}. Anthropic documents that the claimed model returns it ${isText ? 'empty' : 'with summarized text'} unless asked otherwise, so either another model answered${cheaper ? ', possibly a cheaper Anthropic model that behaves this way,' : ''} or something between you and the model changed the setting.`,
    citations: claimed.sources,
  })
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const model = claimedAnthropic(context.target)
  const claimed = model === undefined ? undefined : displayDefault(model)
  if (model === undefined || claimed === undefined) {
    throw new ProbeNotApplicable(
      'Anthropic documents no thinking display default for the claimed model.',
    )
  }
  const seed = await thinkingSeed(context)
  const block = seed.generation?.reasoning.find((item) => item.kind === 'thinking')
  if (!isSuccess(seed.exchange) || block?.kind !== 'thinking') {
    return []
  }
  const hasText = block.text !== undefined && block.text !== ''
  const hasSignature = block.signature !== undefined && block.signature !== ''
  const observed = `With no display set, the first thinking block came back with ${hasText ? `${block.text?.length} characters of text` : 'no text'} and ${hasSignature ? 'a' : 'no'} signature.`
  if (claimed.value === 'omitted' && hasText) {
    return [mismatch(model.id, claimed, 'summarized', observed)]
  }
  if (claimed.value === 'summarized' && !hasText) {
    return hasSignature ? [mismatch(model.id, claimed, 'omitted', observed)] : []
  }
  return [
    causalSignal(ID, {
      signalId: 'documented-default',
      calibration: 'documented',
      observed,
      expected: `With no display set, ${model.id} defaults to "${claimed.value}".`,
      llr: { identity: { 'matches-claim': 0.1 } },
      plainLanguage:
        'The request did not say whether to show thinking, and it came back the way Anthropic documents for the claimed model.',
      citations: claimed.sources,
    }),
  ]
}

function applies(target: ProbeTarget): boolean {
  const model = claimedAnthropic(target)
  return (
    model !== undefined &&
    displayDefault(model) !== undefined &&
    thinkingConfig(model) !== undefined
  )
}

export const thinkingDisplay: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Default thinking display',
  group: 'D',
  protocols: ['anthropic-messages'],
  vendors: ['anthropic'],
  applies,
  needsKey: true,
  cost: { requests: 1, tokens: SEED_TOKENS },
  citations: [
    ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47,
    ANTHROPIC_DISPLAY_OMITTED_OPUS_55,
    ANTHROPIC_DISPLAY_OMITTED_SONNET_5,
    ANTHROPIC_DISPLAY_OMITTED_FABLE_51,
  ],
  run,
})
