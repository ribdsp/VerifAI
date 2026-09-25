/**
 * ε: the share of Group F draws that did not read as the claimed model, and
 * what the order and the losses let us say about it.
 *
 * Every rule here is `docs/scoring.md#4-dispersion-clamp-for-fractional-consistency`,
 * and `verifai verify` recomputes all of it from `epsilon.draws`, so nothing
 * may depend on anything but the draws. With q readable draws (d of them
 * disagreeing) and m lost, the interval runs over all n = q + m attempts, each
 * end pushed as far as the lost attempts allow. The readable draws decide which
 * formula applies; the losses only widen it.
 */

import type { Epsilon } from '../report/types.js'
import type { DilutionRun, DrawRecord } from '../runner/types.js'
import type { ConsistencyFinding } from '../types/assessment.js'

/** The normal quantile for Wilson's interval: 95% two-sided. */
export const WILSON_Z = 1.959963984540054

/** The one-sided level of the exact bounds, and of the runs test. */
export const ALPHA = 0.05

/** Below this many readable draws the two uniform readings cannot be told apart. */
export const MIN_TRIALS = 5

/** A lost share above this means the endpoint obstructed Group F. */
export const MAX_LOST_SHARE = 0.1

const BISECTION_STEPS = 200

function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) {
    return Number.NEGATIVE_INFINITY
  }
  const small = Math.min(k, n - k)
  let sum = 0
  for (let i = 1; i <= small; i += 1) {
    sum += Math.log((n - small + i) / i)
  }
  return sum
}

/** P(X <= x) for X ~ Binomial(n, p), 0 < p < 1. */
function binomialCdf(x: number, n: number, p: number): number {
  const logP = Math.log(p)
  const logQ = Math.log1p(-p)
  let total = 0
  for (let k = 0; k <= x; k += 1) {
    total += Math.exp(logChoose(n, k) + k * logP + (n - k) * logQ)
  }
  return Math.min(1, total)
}

/**
 * The exact (Clopper-Pearson) one-sided upper bound on p after `x` of `n`:
 * the p at which seeing `x` or fewer has probability `ALPHA`.
 */
export function exactUpper(x: number, n: number): number {
  if (x >= n) {
    return 1
  }
  if (x === 0) {
    return 1 - ALPHA ** (1 / n)
  }
  let low = 0
  let high = 1
  for (let step = 0; step < BISECTION_STEPS && high - low > 1e-15; step += 1) {
    const middle = (low + high) / 2
    if (binomialCdf(x, n, middle) > ALPHA) {
      low = middle
    } else {
      high = middle
    }
  }
  return (low + high) / 2
}

function wilson(x: number, n: number, sign: 1 | -1): number {
  // Exact at the ends, where the formula is 0 or 1 but rounding is not.
  if (sign === -1 && x <= 0) {
    return 0
  }
  if (sign === 1 && x >= n) {
    return 1
  }
  const z2 = WILSON_Z * WILSON_Z
  const p = x / n
  const centre = p + z2 / (2 * n)
  const spread = WILSON_Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  const bound = (centre + sign * spread) / (1 + z2 / n)
  return Math.min(1, Math.max(0, bound))
}

export function wilsonLower(x: number, n: number): number {
  return wilson(x, n, -1)
}

export function wilsonUpper(x: number, n: number): number {
  return wilson(x, n, 1)
}

/** The bounds on the non-claimed share, from d of q readable draws and m lost. */
export function epsilonInterval(d: number, q: number, m: number): readonly [number, number] {
  const n = q + m
  if (q === 0) {
    return Object.freeze([0, 1] as const)
  }
  if (d === 0) {
    return Object.freeze([0, exactUpper(m, n)] as const)
  }
  if (d === q) {
    return Object.freeze([1 - exactUpper(m, n), 1] as const)
  }
  return Object.freeze([wilsonLower(d, n), wilsonUpper(d + m, n)] as const)
}

/** The number of maximal blocks of equal outcomes. */
export function runsIn(outcomes: readonly boolean[]): number {
  let runs = 0
  for (const [index, outcome] of outcomes.entries()) {
    if (index === 0 || outcome !== outcomes[index - 1]) {
      runs += 1
    }
  }
  return runs
}

/**
 * P(R <= runs) for `ones` ones and `zeros` zeros in random order: the exact
 * one-sided runs test.
 */
export function fewRunsProbability(runs: number, ones: number, zeros: number): number {
  if (ones === 0 || zeros === 0) {
    return 1
  }
  const total = logChoose(ones + zeros, ones)
  const term = (a: number, b: number) =>
    Math.exp(logChoose(ones - 1, a) + logChoose(zeros - 1, b) - total)
  let probability = 0
  for (let r = 2; r <= runs; r += 1) {
    const k = Math.floor(r / 2)
    probability += r % 2 === 0 ? 2 * term(k - 1, k - 1) : term(k, k - 1) + term(k - 1, k)
  }
  return Math.min(1, probability)
}

function countOf(draws: readonly DrawRecord[], outcome: DrawRecord['outcome']): number {
  return draws.filter((draw) => draw.outcome === outcome).length
}

/** Everything the report says about ε, from the draws alone. */
export function epsilonOf(dilution: DilutionRun): Epsilon {
  const readable = dilution.draws.filter(
    (draw) => draw.outcome === 'agree' || draw.outcome === 'disagree',
  )
  const d = countOf(readable, 'disagree')
  const q = readable.length
  const m = countOf(dilution.draws, 'lost')
  const sequence = readable.map((draw) => draw.outcome === 'disagree')
  const mixed = d > 0 && d < q
  return Object.freeze({
    probeId: dilution.probeId,
    basis: dilution.basis,
    disagreements: d,
    trials: q,
    lost: m,
    estimate: q === 0 ? null : d / q,
    interval: epsilonInterval(d, q, m),
    clustered: mixed && fewRunsProbability(runsIn(sequence), d, q - d) < ALPHA,
    draws: dilution.draws,
  })
}

/** Read from the readable draws: the losses widen the interval, never the finding. */
export function consistencyOf(epsilon: Epsilon | null): ConsistencyFinding {
  if (epsilon === null || epsilon.trials < MIN_TRIALS) {
    return 'unknown'
  }
  return epsilon.disagreements > 0 && epsilon.disagreements < epsilon.trials
    ? 'fractional'
    : 'uniform'
}

/** m / (q + m); 0 when nothing was attempted. */
export function lostShare(epsilon: Epsilon | null): number {
  if (epsilon === null) {
    return 0
  }
  const attempts = epsilon.trials + epsilon.lost
  return attempts === 0 ? 0 : epsilon.lost / attempts
}
