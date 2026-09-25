/**
 * Display formatting. Every function here formats a number it is given and
 * derives nothing: a report's figures are stored, and the report format
 * forbids a renderer from recomputing them.
 */

import {
  type DrawRecord,
  type DrawRecordOutcome,
  type PlannedProbe,
  PROBE_GROUPS,
  type ProbeGroup,
  type RunEvent,
  SIGNAL_FAMILIES,
  type Signal,
  type SkippedProbe,
} from '@verifai/core'
import { FAMILY_NAMES, GROUP_NAMES, labelOf, skipReasonText } from './labels'

const COUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatCount(value: number): string {
  return COUNT.format(value)
}

/** `0.1234` as `12.3%`. */
export function formatPercent(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`
}

export function formatInterval(interval: readonly [number, number], digits = 1): string {
  return `${formatPercent(interval[0], digits)} – ${formatPercent(interval[1], digits)}`
}

/** A probability for a posterior bar: three places, no percent sign. */
export function formatProbability(value: number): string {
  return value.toFixed(3)
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

export function formatDuration(ms: number): string {
  if (ms < SECOND) {
    return `${Math.max(0, Math.round(ms))} ms`
  }
  if (ms < MINUTE) {
    return `${Math.round(ms / SECOND)} s`
  }
  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE)
    const seconds = Math.round((ms % MINUTE) / SECOND)
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`
  }
  const hours = Math.floor(ms / HOUR)
  const minutes = Math.round((ms % HOUR) / MINUTE)
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

/** `used` of `limit` as a share for a bar, kept within `[0, 1]`. */
export function shareOf(used: number, limit: number): number {
  if (!(limit > 0) || !Number.isFinite(used)) {
    return 0
  }
  return Math.min(1, Math.max(0, used / limit))
}

export interface ProbeGroupRow {
  readonly group: ProbeGroup
  readonly name: string
  readonly probes: readonly PlannedProbe[]
}

/** Planned probes by group, A to F, leaving out groups with none. */
export function groupProbes(probes: readonly PlannedProbe[]): readonly ProbeGroupRow[] {
  return PROBE_GROUPS.values.flatMap((group) => {
    const members = probes.filter((probe) => probe.group === group)
    return members.length === 0 ? [] : [{ group, name: GROUP_NAMES[group], probes: members }]
  })
}

/** Skipped probes by reason, in the order the reasons first appear. */
export function groupSkipped(
  skipped: readonly SkippedProbe[],
): readonly { readonly reason: string; readonly text: string; readonly probeIds: string[] }[] {
  const reasons = [...new Set(skipped.map((entry) => entry.reason))]
  return reasons.map((reason) => ({
    reason,
    text: skipReasonText(reason),
    probeIds: skipped.filter((entry) => entry.reason === reason).map((entry) => entry.probeId),
  }))
}

export interface SignalGroup {
  readonly family: string
  readonly name: string
  readonly signals: readonly Signal[]
}

/** Signals by family in core's order, then any family this build does not know. */
export function groupSignals(signals: readonly Signal[]): readonly SignalGroup[] {
  const families = [
    ...SIGNAL_FAMILIES.values,
    ...new Set(
      signals.map((signal) => signal.family).filter((family) => !SIGNAL_FAMILIES.has(family)),
    ),
  ]
  return families.flatMap((family) => {
    const members = signals.filter((signal) => signal.family === family)
    return members.length === 0
      ? []
      : [{ family, name: labelOf(FAMILY_NAMES, family), signals: members }]
  })
}

/** One line of the live log. `tone` picks its marker, never its only signal. */
export interface EventLine {
  readonly tone: 'info' | 'ok' | 'warn' | 'bad'
  readonly text: string
}

function statusText(status: number | null): string {
  return status === null ? 'no response' : `HTTP ${status}`
}

function requestTone(status: number | null): EventLine['tone'] {
  if (status === null || status >= 500) {
    return 'bad'
  }
  return status >= 400 ? 'warn' : 'info'
}

const DRAW_TONES = Object.freeze({
  agree: 'ok',
  disagree: 'bad',
  lost: 'warn',
  excluded: 'warn',
} as const)

export function describeEvent(event: RunEvent): EventLine {
  switch (event.kind) {
    case 'probe-started':
      return {
        tone: 'info',
        text: `${event.probeId} started (${event.index + 1} of ${event.total})`,
      }
    case 'probe-finished':
      return event.status === 'ran'
        ? { tone: 'ok', text: `${event.probeId} finished, ${plural(event.signals, 'signal')}` }
        : {
            tone: 'warn',
            text: `${event.probeId} skipped: ${skipReasonText(event.reason ?? 'not-applicable')}`,
          }
    case 'request':
      return {
        tone: requestTone(event.status),
        text: `${event.probeId} ${statusText(event.status)}`,
      }
    case 'waiting':
      return { tone: 'info', text: `${event.probeId} waiting ${formatDuration(event.waitMs)}` }
    case 'draw':
      return { tone: DRAW_TONES[event.outcome], text: `Draw ${event.draw}: ${event.outcome}` }
    case 'probe-error':
      return { tone: 'bad', text: `${event.probeId} error: ${event.message}` }
  }
}

/** How many draws ended each way. */
export function drawCounts(
  draws: readonly DrawRecord[],
): Readonly<Record<DrawRecordOutcome, number>> {
  const counts = { agree: 0, disagree: 0, lost: 0, excluded: 0 }
  for (const { outcome } of draws) {
    counts[outcome] += 1
  }
  return counts
}

export function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`
}

/** A schema problem's `<=2000` as words. */
export function describeProblem(problem: string): string {
  return problem
    .replace(/<=\s*(\d+)/g, (_, bound: string) => `at most ${formatCount(Number(bound))}`)
    .replace(/>=\s*(\d+)/g, (_, bound: string) => `at least ${formatCount(Number(bound))}`)
}

/**
 * A citation's URL when it is an absolute `https:` URL, for use as a link; any
 * other scheme renders as plain text. The report promises `https:`, but a
 * report is still data from outside this page.
 */
export function safeHttpsUrl(url: string): string | undefined {
  if (!URL.canParse(url)) {
    return undefined
  }
  const parsed = new URL(url)
  return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
    ? parsed.href
    : undefined
}

/** The first twelve hex digits after `sha256:`, for a label; the full hash stays alongside. */
export function shortHash(hash: string): string {
  const hex = hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash
  return hex.length > 12 ? `${hex.slice(0, 12)}…` : hex
}
