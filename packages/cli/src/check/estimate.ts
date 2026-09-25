/**
 * The estimate as `verifai check` prints it before anything is spent.
 *
 * The same facts the web UI's estimate shows, with the same warning words,
 * laid out for a terminal. Probes left out are counted by reason rather than
 * listed: a quick run leaves out most of the catalogue, and forty lines of
 * "not part of the selected profile" would bury the warnings under them.
 */

import {
  AUTH_TEXT,
  type CheckEstimate,
  ESTIMATE_WARNING_TEXT,
  profileDefinition,
  SKIP_REASON_TEXT,
  type SkipReason,
  VENDOR_NAMES,
} from '@verifai/core'

const LABEL_WIDTH = 10

function row(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)} ${value}`
}

export function formatCount(count: number): string {
  return count.toLocaleString('en-US')
}

export function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0 && ms > 0) {
    return `${ms / 3_600_000}h`
  }
  if (ms % 60_000 === 0 && ms > 0) {
    return `${ms / 60_000}m`
  }
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${ms}ms`
}

function plural(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`
}

function skippedLines(estimate: CheckEstimate): string[] {
  const counts = new Map<SkipReason, number>()
  for (const { reason } of estimate.skipped) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts].map(([reason, count]) => `  - ${count} ${SKIP_REASON_TEXT[reason]}`)
}

function warningLines(estimate: CheckEstimate): string[] {
  const texts = estimate.warnings.map((code) => ESTIMATE_WARNING_TEXT[code])
  // The warnings that change what the buyer should do come first.
  const ordered = [...texts.filter((t) => t.prominent), ...texts.filter((t) => !t.prominent)]
  return ordered.map((t) => `  ${t.prominent ? '!' : '-'} ${t.title}: ${t.text}`)
}

export function estimateText(estimate: CheckEstimate, model: string): string {
  const profile = profileDefinition(estimate.profile)
  const lines = [
    row(
      'Target',
      `${model} (${VENDOR_NAMES[estimate.vendor]}) over ${estimate.protocol}, ${estimate.pairing} pairing`,
    ),
    row('Key', `sent as ${AUTH_TEXT[estimate.auth]}`),
    row('Profile', `${estimate.profile} - ${profile.description}`),
    row(
      'Probes',
      `${plural(estimate.probes.length, 'probe')} planned, ${formatCount(estimate.skipped.length)} left out`,
    ),
    row(
      'Spend',
      `up to ${plural(estimate.requests, 'request')} and ${plural(estimate.tokens, 'token')} (caps ${formatCount(estimate.maxRequests)} and ${formatCount(estimate.maxTokens)})`,
    ),
    ...(estimate.draws > 0
      ? [
          row(
            'Dilution',
            `${plural(estimate.draws, 'draw')}${estimate.spreadMs > 0 ? ` spread over ${formatDuration(estimate.spreadMs)}` : ''}`,
          ),
        ]
      : []),
  ]
  const skipped = skippedLines(estimate)
  const warnings = warningLines(estimate)
  return [
    ...lines,
    ...(skipped.length === 0 ? [] : ['', 'Left out:', ...skipped]),
    ...(warnings.length === 0 ? [] : ['', 'Warnings:', ...warnings]),
  ].join('\n')
}
