/**
 * Where a reference fact came from, and how strongly that source supports it.
 *
 * `FactSource` has the same shape as `@verifai/core`'s `Citation`, so a probe
 * can cite a fact's sources directly. This package cannot import core, so the
 * shape and its checks are repeated here rather than shared.
 *
 * A quote is the page's Markdown source with two changes: link markup is
 * reduced to the link text, and runs of whitespace (table padding, line
 * breaks) collapse to one space. Code spans, emphasis and table pipes stay as
 * written, and nothing else about the words may change.
 */

export interface FactSource {
  /** `https:` only. */
  readonly url: string
  /** Verbatim text from `url`, whitespace-trimmed. Never paraphrased. */
  readonly quote: string
  /** `YYYY-MM-DD`, the day the quote was checked against `url`. */
  readonly retrievedAt: string
}

/** The day the quotes in this release were checked against their pages; a later check keeps its own date. */
export const RETRIEVED_AT = '2026-09-24'

/** Long enough for a sentence or two; a longer quote is a sign of pasting a page. */
export const MAX_QUOTE_LENGTH = 1200

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** @throws TypeError naming what is wrong. Sources are written by hand, so this runs at module load. */
export function source(url: string, quote: string, retrievedAt: string = RETRIEVED_AT): FactSource {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError(`A fact source URL must be absolute: ${JSON.stringify(url)}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new TypeError(`A fact source URL must use https: ${JSON.stringify(url)}`)
  }
  const trimmed = quote.trim()
  if (trimmed === '') {
    throw new TypeError(`A fact source for ${url} has an empty quote`)
  }
  if (trimmed.length > MAX_QUOTE_LENGTH) {
    throw new TypeError(`A fact source for ${url} quotes more than ${MAX_QUOTE_LENGTH} characters`)
  }
  if (!ISO_DATE.test(retrievedAt)) {
    throw new TypeError(`A fact source for ${url} needs a YYYY-MM-DD retrieval date`)
  }
  return Object.freeze({ url, quote: trimmed, retrievedAt })
}

/**
 * Strongest first, as in `docs/PROVENANCE.md`: `measured` is ground truth
 * recorded with a first-party key, `documented` is the vendor's own sentence,
 * `derived` follows a published method, `heuristic` is an inference the
 * scorer caps low.
 */
export type Calibration = 'measured' | 'documented' | 'derived' | 'heuristic'

export interface Fact<T> {
  readonly value: T
  readonly calibration: Calibration
  readonly sources: Sources
  /** A condition the value depends on, or the step from the quote to the value. */
  readonly note?: string
}

/** Sources in the order a reader should check them; the first is the one that says it outright. */
export type Sources = readonly [FactSource, ...FactSource[]]

/**
 * Freezes the fact, its source list and - one level down - its value, which
 * is a primitive or a flat record literal everywhere in this package.
 *
 * @throws TypeError for an empty source list or a blank note, either of which
 * would render as a fact that points at nothing.
 */
export function fact<T>(
  calibration: Calibration,
  value: T,
  sources: Sources,
  note?: string,
): Fact<T> {
  if (sources.length === 0) {
    throw new TypeError('A fact needs at least one source')
  }
  if (note !== undefined && note.trim() === '') {
    throw new TypeError('A fact note must not be blank')
  }
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value)
  }
  return Object.freeze({
    value,
    calibration,
    sources: Object.freeze([...sources]) as Sources,
    ...(note === undefined ? {} : { note }),
  })
}

/** A fact stated in the vendor's own documentation. */
export function documented<T>(value: T, sources: Sources, note?: string): Fact<T> {
  return fact('documented', value, sources, note)
}
