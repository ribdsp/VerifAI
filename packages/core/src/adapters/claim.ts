/**
 * The vendor's name for the model a gateway sells under its own.
 *
 * Resellers rarely pass a vendor's model id through untouched. They prefix a
 * namespace (`reseller/claude-opus-4.6`, `anthropic/claude-sonnet-5`), a
 * platform prefixes the vendor (`openai-gpt-5.4` on Snowflake Cortex), and a
 * Claude version gets the dot the announcements use instead of the dash the
 * API does. Every request must carry the name the gateway takes; every fact a
 * probe looks up is filed under the vendor's. This finds the second from the
 * first, and only by taking decoration away: an id is rewritten only when the
 * id as typed is not a documented model name and the rewrite is one.
 */

import { anthropicModel, OPENAI_CHAT_MODEL_IDS, openaiModel } from '@verifai/fingerprints'
import type { Vendor } from '../types/target.js'

/** `openai-gpt-5.4`, and Snowflake's first-party `openai-1p-gpt-5.6-sol`. */
const VENDOR_PREFIX = /^(?:openai|anthropic)-(?:1p-)?/

/** `4.6` in a Claude id, which the API writes `4-6`. */
const DOTTED_VERSION = /(\d)\.(?=\d)/g

/**
 * OpenAI's model catalog holds only the reasoning models whose rules its
 * guides settle; the Chat Completions model enum names every other one.
 */
const OPENAI_CHAT_IDS: ReadonlySet<string> = new Set(OPENAI_CHAT_MODEL_IDS)

const CATALOGS: Readonly<Record<Vendor, (id: string) => boolean>> = Object.freeze({
  anthropic: (id: string) => anthropicModel(id) !== undefined,
  openai: (id: string) => openaiModel(id) !== undefined || OPENAI_CHAT_IDS.has(id),
})

function isDocumented(id: string, vendor: Vendor | undefined): boolean {
  const vendors: readonly Vendor[] = vendor === undefined ? ['anthropic', 'openai'] : [vendor]
  return vendors.some((each) => CATALOGS[each](id))
}

/** Each step removes one kind of decoration from the one before. */
function candidatesOf(modelId: string): readonly string[] {
  const lowered = modelId.toLowerCase()
  const segment = lowered.slice(lowered.lastIndexOf('/') + 1)
  const unprefixed = segment.replace(VENDOR_PREFIX, '')
  const dashed = unprefixed.startsWith('claude-')
    ? unprefixed.replace(DOTTED_VERSION, '$1-')
    : unprefixed
  return [...new Set([modelId, lowered, segment, unprefixed, dashed])]
}

/**
 * The documented model name `modelId` stands for, looked up in `vendor`'s
 * catalog or, without one, in either. `modelId` itself when it is documented
 * or when no rewrite is.
 */
export function documentedModelName(modelId: string, vendor?: Vendor): string {
  return candidatesOf(modelId).find((id) => isDocumented(id, vendor)) ?? modelId
}
