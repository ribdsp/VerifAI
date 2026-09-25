/**
 * The four profiles of `docs/methodology.md#cost-control`, as data.
 *
 * A profile decides which groups run, how many Group F repetitions there are
 * and how they are spaced, and whether probe order is shuffled. The budget it
 * carries is a default the buyer can lower or raise per run; it is sized so
 * that the profile's own probes fit, not so that a run is cheap.
 */

import type { ProbeGroup } from '../probes/types.js'
import { type Member, vocabulary } from '../types/vocabulary.js'

export const PROFILES = vocabulary(['quick', 'standard', 'deep', 'paranoid'])
export type Profile = Member<typeof PROFILES>

export const DEFAULT_PROFILE: Profile = 'standard'

/** Thirty agreeing repetitions bound dilution below 9.5% - see `docs/scoring.md`. */
export const DEFAULT_DRAWS = 30

/** How far `paranoid` spreads its repetitions. */
export const PARANOID_SPREAD_MS = 10 * 60 * 1000

/** Past this a spread is a scheduling mistake rather than a strategy. */
export const MAX_SPREAD_MS = 60 * 60 * 1000

export const MAX_REQUESTS_LIMIT = 2000
export const MAX_TOKENS_LIMIT = 2_000_000

export interface ProfileDefinition {
  readonly profile: Profile
  readonly description: string
  readonly groups: readonly ProbeGroup[]
  /** Group F repetitions; `0` when the profile does not run Group F. */
  readonly draws: number
  readonly spreadMs: number
  readonly shuffle: boolean
  readonly maxRequests: number
  readonly maxTokens: number
}

function define(definition: ProfileDefinition): ProfileDefinition {
  return Object.freeze({ ...definition, groups: Object.freeze([...definition.groups]) })
}

const DEFINITIONS: Readonly<Record<Profile, ProfileDefinition>> = Object.freeze({
  quick: define({
    profile: 'quick',
    description: 'Protocol conformance only. Close to free, and never enough for a pass.',
    groups: ['A'],
    draws: 0,
    spreadMs: 0,
    shuffle: false,
    maxRequests: 120,
    maxTokens: 5_000,
  }),
  standard: define({
    profile: 'standard',
    description: 'Conformance, accounting and tokenizer forensics, plus 30 dilution repetitions.',
    groups: ['A', 'B', 'C', 'F'],
    draws: DEFAULT_DRAWS,
    spreadMs: 0,
    shuffle: false,
    maxRequests: 400,
    maxTokens: 40_000,
  }),
  deep: define({
    profile: 'deep',
    description: 'Everything in standard, plus the causal capability probes.',
    groups: ['A', 'B', 'C', 'D', 'E', 'F'],
    draws: DEFAULT_DRAWS,
    spreadMs: 0,
    shuffle: false,
    maxRequests: 600,
    maxTokens: 250_000,
  }),
  paranoid: define({
    profile: 'paranoid',
    description:
      'Everything in deep, in a shuffled order, with repetitions spread over 10 minutes.',
    groups: ['A', 'B', 'C', 'D', 'E', 'F'],
    draws: DEFAULT_DRAWS,
    spreadMs: PARANOID_SPREAD_MS,
    shuffle: true,
    maxRequests: 600,
    maxTokens: 250_000,
  }),
})

export function profileDefinition(profile: Profile): ProfileDefinition {
  if (!PROFILES.has(profile)) {
    throw new TypeError(`Not a profile: ${JSON.stringify(profile)}`)
  }
  return DEFINITIONS[profile]
}
