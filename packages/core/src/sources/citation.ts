/**
 * Where an expected behaviour came from: a URL, the words at that URL, and the
 * day they were read.
 *
 * Every signal carries at least one. A flag a buyer cannot trace back to a
 * vendor's own sentence - or to a measurement this project published - is an
 * opinion, and `docs/report-format.md` treats a signal without citations as a
 * construction error rather than a weak signal. So the builder refuses the
 * cases that would render as a citation while pointing at nothing.
 */

export interface Citation {
  /** `https:` only. */
  readonly url: string
  /** Verbatim from `url`, whitespace-trimmed. Never paraphrased. */
  readonly quote: string
  /** `YYYY-MM-DD`, the day the quote was checked against `url`. */
  readonly retrievedAt: string
}

/** Long enough for a sentence or two; a longer quote is a sign of pasting a page. */
export const MAX_QUOTE_LENGTH = 1200

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** @throws TypeError naming what is wrong. Citations are written by hand, so this runs at module load. */
export function citation(url: string, quote: string, retrievedAt: string): Citation {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError(`A citation URL must be absolute: ${JSON.stringify(url)}`)
  }
  if (parsed.protocol !== 'https:') {
    throw new TypeError(`A citation URL must use https: ${JSON.stringify(url)}`)
  }
  const trimmed = quote.trim()
  if (trimmed === '') {
    throw new TypeError(`A citation of ${url} has an empty quote`)
  }
  if (trimmed.length > MAX_QUOTE_LENGTH) {
    throw new TypeError(`A citation of ${url} quotes more than ${MAX_QUOTE_LENGTH} characters`)
  }
  if (!ISO_DATE.test(retrievedAt)) {
    throw new TypeError(`A citation of ${url} needs a YYYY-MM-DD retrieval date`)
  }
  return Object.freeze({ url, quote: trimmed, retrievedAt })
}
