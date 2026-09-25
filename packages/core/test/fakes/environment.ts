/**
 * A run environment the test controls: a clock that moves only when the run
 * sleeps, so a spread of ten minutes takes no time at all, and a random that
 * says what it is told.
 */

import type { RunEnvironment } from '../../src/runner/session.js'

export interface Harness {
  readonly environment: RunEnvironment
  readonly slept: number[]
  now: number
}

/** A clock that only moves when the run sleeps, and a random that is not. */
export function harness(random: () => number = () => 0.5): Harness {
  const state: Harness = {
    slept: [],
    now: 0,
    environment: {
      clock: () => state.now,
      wallClock: () => 1_800_000_000_000 + state.now,
      sleep: async (ms) => {
        state.slept.push(ms)
        state.now += ms
      },
      random,
    },
  }
  return state
}
