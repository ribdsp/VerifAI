/**
 * A seeded shuffle, so a `paranoid` run's order can be replayed from the seed
 * the report records.
 *
 * The seed is hashed with 32-bit FNV-1a into the state of a mulberry32
 * generator, which drives a Fisher-Yates shuffle. None of this needs to be
 * unpredictable to the endpoint: the seed itself is drawn fresh each run by the
 * caller, and what the order defeats is a proxy that recognises probes by their
 * position, not one that can read the seed.
 */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1a(text: string): number {
  let hash = FNV_OFFSET
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), FNV_PRIME) >>> 0
  }
  return hash
}

/** A generator of floats in [0, 1), from a 32-bit state. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** A new array with `items` in an order fixed by `seed`. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(fnv1a(seed))
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const held = shuffled[index] as T
    shuffled[index] = shuffled[other] as T
    shuffled[other] = held
  }
  return shuffled
}
