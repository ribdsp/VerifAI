/**
 * Which probes a run sends, in what order, and what it may spend:
 * `docs/methodology.md#cost-control`.
 *
 * The catalogue's order is its priority. A probe is kept when its group is in
 * the profile and it applies to the target; of those, each is admitted in
 * catalogue order while its declared cost still fits the budget, so a tight
 * budget drops the dearer, later groups first and never a cheap probe for a
 * dear one. A probe that was never evidence here - outside the profile, or for
 * another protocol, vendor or model - leaves no record. One that should have
 * run and will not is recorded with its reason, because the confidence
 * ceiling counts it as a gap.
 *
 * `paranoid` shuffles what was admitted, seeded so the report can say which
 * order ran. Group F always goes last: its repetitions may be spread over
 * minutes, and nothing else should wait behind them.
 */

import type { AnyProbe, ProbeTarget } from '../probes/types.js'
import { isDilutionProbe } from '../probes/types.js'
import { replacementAllowance } from '../runner/dilution.js'
import type { ProbeOutcome, SkippedProbe, SkipReason } from '../runner/types.js'
import {
  MAX_REQUESTS_LIMIT,
  MAX_SPREAD_MS,
  MAX_TOKENS_LIMIT,
  type Profile,
  profileDefinition,
} from './profiles.js'
import { seededShuffle } from './shuffle.js'

const SEED = /^[a-z0-9]{8,64}$/

export interface PlanOptions {
  readonly target: ProbeTarget
  readonly profile: Profile
  readonly hasKey: boolean
  /** Every probe VerifAI has, in priority order. */
  readonly catalogue: readonly AnyProbe[]
  /** Defaults to the profile's. */
  readonly maxRequests?: number
  /** Defaults to the profile's. `0` admits only probes that spend no tokens. */
  readonly maxTokens?: number
  /** Defaults to the profile's. */
  readonly spreadMs?: number
  /** Opt-in probes the buyer named. */
  readonly optIn?: readonly string[]
  /** Whether the transport can say which requests went out on a fresh connection. */
  readonly dilutionSupported: boolean
  /** Fixes a shuffled order; 8 to 64 characters of [a-z0-9]. */
  readonly orderSeed: string
}

export interface ProbePlan {
  readonly profile: Profile
  /** In the order they will run. */
  readonly probes: readonly AnyProbe[]
  readonly skipped: readonly SkippedProbe[]
  /** One per skipped probe, for the scoring's coverage. */
  readonly outcomes: readonly ProbeOutcome[]
  /** The admitted probes' declared upper bounds, together. */
  readonly requests: number
  readonly tokens: number
  readonly maxRequests: number
  readonly maxTokens: number
  /** Group F repetitions; `0` when no Group F probe was admitted. */
  readonly draws: number
  /** `0` when no Group F probe was admitted. */
  readonly spreadMs: number
  readonly orderSeed: string
  readonly shuffled: boolean
  /** Some applicable probe did not fit the budget. */
  readonly budgetLimited: boolean
  /** Group F applied and the transport cannot keep its draws independent. */
  readonly dilutionUnsupported: boolean
}

export interface ProbeCost {
  readonly requests: number
  readonly tokens: number
}

/**
 * What a probe may spend at most. A Group F probe declares one draw, so it is
 * multiplied by the draws, the replacements the runner may add, and one more
 * for the preparation.
 */
export function probeCost(probe: AnyProbe, draws: number): ProbeCost {
  if (!isDilutionProbe(probe)) {
    return probe.cost
  }
  const times = draws + replacementAllowance(draws) + 1
  return { requests: probe.cost.requests * times, tokens: probe.cost.tokens * times }
}

function checkRange(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be a whole number from ${min} to ${max}`)
  }
  return value
}

function applies(probe: AnyProbe, target: ProbeTarget): boolean {
  return (
    probe.protocols.includes(target.protocol) &&
    probe.vendors.includes(target.claimedVendor) &&
    (probe.applies?.(target) ?? true)
  )
}

function checkCatalogue(catalogue: readonly AnyProbe[]): void {
  const ids = new Set(catalogue.map((probe) => probe.id))
  if (ids.size !== catalogue.length) {
    throw new TypeError('The probe catalogue lists a probe twice')
  }
}

interface Budget {
  readonly maxRequests: number
  readonly maxTokens: number
  requests: number
  tokens: number
}

interface Selection {
  readonly admitted: AnyProbe[]
  readonly skipped: SkippedProbe[]
  readonly outcomes: ProbeOutcome[]
  budgetLimited: boolean
  dilutionUnsupported: boolean
}

/** Why an applicable probe cannot run whatever the budget, if anything stops it. */
function blockedBy(probe: AnyProbe, options: PlanOptions): SkipReason | undefined {
  if (probe.optIn === true && options.optIn?.includes(probe.id) !== true) {
    return 'opt-in'
  }
  if (probe.needsKey && !options.hasKey) {
    return 'needs-api-key'
  }
  if (isDilutionProbe(probe) && !options.dilutionSupported) {
    return 'unsupported-by-transport'
  }
  return undefined
}

function fits(cost: ProbeCost, budget: Budget): boolean {
  return (
    budget.requests + cost.requests <= budget.maxRequests &&
    budget.tokens + cost.tokens <= budget.maxTokens
  )
}

function skip(selection: Selection, probe: AnyProbe, reason: SkipReason): void {
  selection.skipped.push(Object.freeze({ probeId: probe.id, reason }))
  selection.outcomes.push(
    Object.freeze({ probeId: probe.id, group: probe.group, status: 'skipped', reason }),
  )
}

function consider(probe: AnyProbe, options: PlanOptions, budget: Budget, selection: Selection) {
  const blocked = blockedBy(probe, options)
  if (blocked !== undefined) {
    selection.dilutionUnsupported ||= blocked === 'unsupported-by-transport'
    skip(selection, probe, blocked)
    return
  }
  const cost = probeCost(probe, profileDefinition(options.profile).draws)
  if (!fits(cost, budget)) {
    selection.budgetLimited = true
    skip(selection, probe, 'budget-exceeded')
    return
  }
  budget.requests += cost.requests
  budget.tokens += cost.tokens
  selection.admitted.push(probe)
}

function ordered(admitted: readonly AnyProbe[], shuffle: boolean, seed: string): AnyProbe[] {
  const rest = admitted.filter((probe) => !isDilutionProbe(probe))
  const dilution = admitted.filter(isDilutionProbe)
  if (dilution.length > 1) {
    throw new TypeError('A run takes at most one Group F probe')
  }
  return [...(shuffle ? seededShuffle(rest, seed) : rest), ...dilution]
}

export function planProbes(options: PlanOptions): ProbePlan {
  const definition = profileDefinition(options.profile)
  if (!SEED.test(options.orderSeed)) {
    throw new TypeError('An order seed is 8 to 64 characters of [a-z0-9]')
  }
  checkCatalogue(options.catalogue)
  const budget: Budget = {
    maxRequests: checkRange(
      options.maxRequests ?? definition.maxRequests,
      1,
      MAX_REQUESTS_LIMIT,
      'maxRequests',
    ),
    maxTokens: checkRange(
      options.maxTokens ?? definition.maxTokens,
      0,
      MAX_TOKENS_LIMIT,
      'maxTokens',
    ),
    requests: 0,
    tokens: 0,
  }
  const spreadMs = checkRange(options.spreadMs ?? definition.spreadMs, 0, MAX_SPREAD_MS, 'spreadMs')
  const selection: Selection = {
    admitted: [],
    skipped: [],
    outcomes: [],
    budgetLimited: false,
    dilutionUnsupported: false,
  }
  for (const probe of options.catalogue) {
    if (definition.groups.includes(probe.group) && applies(probe, options.target)) {
      consider(probe, options, budget, selection)
    }
  }
  const probes = ordered(selection.admitted, definition.shuffle, options.orderSeed)
  const hasDilution = probes.some(isDilutionProbe)
  return Object.freeze({
    profile: definition.profile,
    probes: Object.freeze(probes),
    skipped: Object.freeze(selection.skipped),
    outcomes: Object.freeze(selection.outcomes),
    requests: budget.requests,
    tokens: budget.tokens,
    maxRequests: budget.maxRequests,
    maxTokens: budget.maxTokens,
    draws: hasDilution ? definition.draws : 0,
    spreadMs: hasDilution ? spreadMs : 0,
    orderSeed: options.orderSeed,
    shuffled: definition.shuffle,
    budgetLimited: selection.budgetLimited,
    dilutionUnsupported: selection.dilutionUnsupported,
  })
}
