/**
 * Removes API keys from any text before it is rendered, logged or reported.
 *
 * A key reaches output by more routes than the request that carried it. The
 * endpoint under test is, by assumption, not trustworthy, and its error bodies
 * routinely quote what they were sent - whole, JSON-escaped inside a message,
 * percent-encoded inside a URL, or cut to a prefix (`Incorrect API key
 * provided: sk-proj-abc...`). So the redactor matches every one of those forms,
 * and any fragment of a key long enough to be key material.
 *
 * Matching is by plain substring comparison. No secret is ever turned into a
 * regular expression: a key is arbitrary visible ASCII, and `.*` in a key must
 * not redact every line of a report.
 */

export const REDACTION_MARKER = '[REDACTED]'

/**
 * The shortest fragment of a key treated as the key.
 *
 * Vendor prefixes are public - `sk-ant-api03-` is 13 characters and appears in
 * every vendor's documentation, which VerifAI quotes in its reports. A 16
 * character window therefore always contains characters from the random part
 * of a key, while anything shorter would redact the documentation's own
 * example prefixes out of the citations. Secrets shorter than this are matched
 * whole, or cut short beside a truncation marker.
 */
export const PARTIAL_MATCH_LENGTH = 16

/**
 * The shortest piece of a short secret treated as the secret, and only where
 * it runs into a truncation marker. A key under `PARTIAL_MATCH_LENGTH` has no
 * window to match, so an echo that cuts it to `sk-12...` would otherwise keep
 * most of it; the marker is what says the piece is a key rather than text.
 */
export const MIN_TRUNCATED_LENGTH = 4

/** What an echo that cuts a key short puts where the rest was: `sk-12...`, `sk-1***`, `…1234`. */
const TRUNCATION_MARKERS: readonly string[] = Object.freeze(['...', '…', '*'])

export type Redactor = (text: string) => string

/** Text to find, and the `[start, end)` of each occurrence that is key material. */
interface Needle {
  readonly find: string
  readonly start: number
  readonly end: number
}

interface Patterns {
  /** Every `PARTIAL_MATCH_LENGTH` window of every form of every long secret. */
  readonly windows: ReadonlySet<string>
  /** Every form of every short secret, whole and cut short beside a marker. */
  readonly needles: readonly Needle[]
}

/** `[start, end)` in UTF-16 code units. */
type Span = readonly [start: number, end: number]

/**
 * `undefined` for a secret with a lone surrogate. `encodeURIComponent` throws
 * on one, and for the same reason no URL can carry that secret percent-encoded,
 * so there is no form to look for rather than an error to report.
 */
function percentEncoded(secret: string): string | undefined {
  try {
    return encodeURIComponent(secret)
  } catch (error) {
    if (error instanceof URIError) {
      return undefined
    }
    throw error
  }
}

/** The raw secret and the escaped forms it takes inside JSON and URLs. */
function formsOf(secret: string): readonly string[] {
  const encoded = percentEncoded(secret)
  const forms = [
    secret,
    JSON.stringify(secret).slice(1, -1),
    ...(encoded === undefined ? [] : [encoded]),
  ]
  return [...new Set(forms)]
}

/** A short secret's form whole, and every piece of it long enough to count, cut short. */
function shortNeedles(form: string): Needle[] {
  const pieces = Array.from(
    { length: Math.max(0, form.length - MIN_TRUNCATED_LENGTH) },
    (_, at) => {
      const length = MIN_TRUNCATED_LENGTH + at
      return TRUNCATION_MARKERS.flatMap((marker): Needle[] => [
        { find: form.slice(0, length) + marker, start: 0, end: length },
        { find: marker + form.slice(-length), start: marker.length, end: marker.length + length },
      ])
    },
  )
  return [{ find: form, start: 0, end: form.length }, ...pieces.flat()]
}

function compile(secrets: readonly string[]): Patterns {
  const windows = new Set<string>()
  const needles = new Map<string, Needle>()

  for (const secret of new Set(secrets)) {
    if (secret === '') {
      continue
    }

    const isLong = secret.length >= PARTIAL_MATCH_LENGTH
    for (const form of formsOf(secret)) {
      if (!isLong) {
        for (const needle of shortNeedles(form)) {
          needles.set(`${needle.start}:${needle.end}:${needle.find}`, needle)
        }
        continue
      }
      for (let at = 0; at + PARTIAL_MATCH_LENGTH <= form.length; at += 1) {
        windows.add(form.slice(at, at + PARTIAL_MATCH_LENGTH))
      }
    }
  }

  return { windows, needles: [...needles.values()] }
}

/**
 * One pass over the text, looking each window up in a set, so the cost is
 * linear in the text however long the key is or however often it repeats.
 * Consecutive matching windows are already merged here: a run of key material
 * longer than a window is covered by the windows inside it.
 */
function windowSpans(text: string, windows: ReadonlySet<string>): Span[] {
  const spans: Span[] = []
  let start = -1
  let end = -1

  for (let at = 0; at + PARTIAL_MATCH_LENGTH <= text.length; at += 1) {
    if (!windows.has(text.slice(at, at + PARTIAL_MATCH_LENGTH))) {
      continue
    }
    if (at > end) {
      if (end !== -1) {
        spans.push([start, end])
      }
      start = at
    }
    end = at + PARTIAL_MATCH_LENGTH
  }

  if (end !== -1) {
    spans.push([start, end])
  }
  return spans
}

function needleSpans(text: string, needles: readonly Needle[]): Span[] {
  const spans: Span[] = []

  for (const { find, start, end } of needles) {
    for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + 1)) {
      spans.push([at + start, at + end])
    }
  }
  return spans
}

/** Overlapping and touching spans become one, so adjacent keys leave one marker. */
function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((left, right) => left[0] - right[0])
  const merged: [number, number][] = []

  for (const [start, end] of sorted) {
    const last = merged.at(-1)
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }
  return merged
}

function replaceSpans(text: string, spans: readonly Span[]): string {
  const pieces: string[] = []
  let cursor = 0

  for (const [start, end] of spans) {
    pieces.push(text.slice(cursor, start), REDACTION_MARKER)
    cursor = end
  }
  pieces.push(text.slice(cursor))
  return pieces.join('')
}

/**
 * Builds a redactor for a fixed set of secrets. The secrets are read once, so
 * changing the array afterwards changes nothing. Empty strings are ignored.
 */
export function createRedactor(secrets: readonly string[]): Redactor {
  const { windows, needles } = compile(secrets)

  if (windows.size === 0 && needles.length === 0) {
    return (text) => text
  }

  return (text) => {
    const spans = [...windowSpans(text, windows), ...needleSpans(text, needles)]
    return spans.length === 0 ? text : replaceSpans(text, mergeSpans(spans))
  }
}
