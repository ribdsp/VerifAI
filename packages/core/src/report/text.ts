/**
 * What every renderer shares: making untrusted text safe to print, and the
 * readings of the report's numbers that are display rather than arithmetic.
 *
 * Much of a report's text arrived from the endpoint under test. A signal's
 * `observed` can quote an error body, and an endpoint that knows it is being
 * checked can put anything in one: terminal escape sequences that repaint the
 * verdict, bidirectional overrides that reorder a line, markdown that turns a
 * quoted error into a link. So every renderer reads text through `plainText`
 * first, and the markdown view escapes what is left on top of that.
 *
 * Nothing here computes a number the report does not hold. The interval is
 * printed as stored, to one decimal of a percent.
 */

import type { Signal } from '../probes/types.js'
import type { EvidenceEntry } from '../runner/types.js'
import type { Citation } from '../sources/citation.js'
import { ADVERSE_IDENTITY_FINDINGS } from '../types/assessment.js'
import type { Epsilon } from './types.js'

/** C0 and C1 controls, DEL, and the marks and overrides that reorder text. */
function isUnsafe(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

/** One line of printable text: every control or reordering character becomes a space. */
export function plainText(text: string): string {
  return Array.from(text, (char) => (isUnsafe(char.codePointAt(0) ?? 0) ? ' ' : char)).join('')
}

export function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}

export function decimal(value: number): string {
  return value.toFixed(2)
}

function signed(value: number): string {
  return value > 0 ? `+${decimal(value)}` : decimal(value)
}

/** Which way a signal leans on the question the buyer asked: is this the model I paid for? */
export type Stance = 'supports' | 'against' | 'context'

export function stanceOf(signal: Signal): Stance {
  if (signal.vetoes?.includes('matches-claim') === true) {
    return 'against'
  }
  const identity = signal.llr.identity ?? {}
  const adverse = ADVERSE_IDENTITY_FINDINGS.values.map((finding) => identity[finding] ?? 0)
  const net = (identity['matches-claim'] ?? 0) - Math.max(0, ...adverse)
  if (net > 0) {
    return 'supports'
  }
  return net < 0 ? 'against' : 'context'
}

/** `identity matches-claim +0.30, different-vendor -0.60; platform first-party +0.30`. */
export function weightOf(signal: Signal): string {
  const axes = Object.entries(signal.llr).map(([axis, findings]) => {
    const parts = Object.entries(findings as Record<string, number>).map(
      ([finding, value]) => `${finding} ${signed(value)}`,
    )
    return `${axis} ${parts.join(', ')}`
  })
  const vetoes = signal.vetoes === undefined ? [] : [`rules out ${signal.vetoes.join(', ')}`]
  const all = [...axes, ...vetoes]
  return all.length === 0 ? 'no weight' : all.join('; ')
}

export interface Footnotes {
  /** Each distinct citation once, in the order the signals first cite it. */
  readonly sources: readonly Citation[]
  /** The footnote numbers, from 1, of each signal's citations. */
  readonly numbers: readonly (readonly number[])[]
}

export function footnotesOf(signals: readonly Signal[]): Footnotes {
  const index = new Map<string, number>()
  const sources: Citation[] = []
  const numbers = signals.map((signal) =>
    signal.citations.map((citation) => {
      const key = `${citation.url}\n${citation.quote}`
      const known = index.get(key)
      if (known !== undefined) {
        return known
      }
      sources.push(citation)
      index.set(key, sources.length)
      return sources.length
    }),
  )
  return { sources, numbers }
}

/** What each Group F draw was judged against. */
const JUDGED_AGAINST: Readonly<Record<Epsilon['basis'], string>> = Object.freeze({
  reference: "the claimed model's known answer",
  mode: "the run's most common answer",
})

/**
 * The Group F reading, as stored: counts, and the interval beside them. A check is more than
 * one request and a majority need not be the claimed model, so neither is claimed here.
 */
export function epsilonSummary(epsilon: Epsilon): string {
  if (epsilon.estimate === null) {
    return `no repeated check could be read (${epsilon.lost} lost)`
  }
  const [low, high] = epsilon.interval
  const lost = epsilon.lost === 0 ? '' : `, ${epsilon.lost} lost`
  const clustered = epsilon.clustered ? '; the disagreements came in runs' : ''
  return `${epsilon.disagreements} of ${epsilon.trials} repeated checks disagreed with ${JUDGED_AGAINST[epsilon.basis]}${lost}; the share of checks that do is ${percent(low)} to ${percent(high)} (95% bounds)${clustered}`
}

/** `12 requests: 200 x3, 400 x8, no response x1`. */
export function evidenceSummary(evidence: readonly EvidenceEntry[]): string {
  const counts = new Map<string, number>()
  for (const entry of evidence) {
    const key = entry.status === null ? 'no response' : String(entry.status)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key} x${count}`)
  const noun = evidence.length === 1 ? 'request' : 'requests'
  return parts.length === 0 ? 'no requests' : `${evidence.length} ${noun}: ${parts.join(', ')}`
}
