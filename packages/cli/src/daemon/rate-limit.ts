/**
 * A fixed-window request counter.
 *
 * One counter for the whole process rather than one per client: every client
 * is on this machine and arrives from the same address, so a per-address
 * limit would be the same limit with more bookkeeping.
 */

export type Admission =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterSeconds: number }

export interface WindowLimiter {
  /** Counts one event and says whether it was within the limit. */
  readonly take: () => Admission
  /** Whether the next `take` would be refused, without counting one. */
  readonly exhausted: () => Admission
}

export interface LimiterOptions {
  readonly limit: number
  readonly windowMs: number
  readonly now?: () => number
}

export function createWindowLimiter(options: LimiterOptions): WindowLimiter {
  const now = options.now ?? Date.now
  let windowStart = now()
  let count = 0

  const roll = () => {
    const at = now()
    if (at - windowStart >= options.windowMs) {
      windowStart = at
      count = 0
    }
    return at
  }
  const refusal = (at: number): Admission => ({
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + options.windowMs - at) / 1000)),
  })

  return Object.freeze({
    take: (): Admission => {
      const at = roll()
      if (count >= options.limit) {
        return refusal(at)
      }
      count += 1
      return { ok: true }
    },
    exhausted: (): Admission => {
      const at = roll()
      return count >= options.limit ? refusal(at) : { ok: true }
    },
  })
}
