/**
 * The terminal view's content, pasteable into a support ticket or a dispute.
 *
 * Markdown is where untrusted text does the most damage: a quoted error body
 * could otherwise become a link, an image, raw HTML, or a table cell break
 * that shifts every column after it. So each value from the report is made
 * plain, HTML-escaped, then backslash-escaped, and always sits after a label
 * so it never starts a line where block syntax would apply.
 */

import type { Signal } from '../probes/types.js'
import type { EvidenceEntry } from '../runner/types.js'
import {
  AUTH_TEXT,
  CEILING_REASON_TEXT,
  CONSISTENCY_TEXT,
  DISCLAIMER,
  EVIDENCE_TEXT,
  HEADLINE_LABELS,
  IDENTITY_TEXT,
  PLATFORM_TEXT,
  SKIP_REASON_TEXT,
  TRANSLATION_TEXT,
  VENDOR_NAMES,
} from './labels.js'
import {
  epsilonSummary,
  evidenceSummary,
  type Footnotes,
  footnotesOf,
  percent,
  plainText,
  weightOf,
} from './text.js'
import type { Report } from './types.js'

const HTML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
})

/** One line of inert markdown text. */
export function markdownText(text: string): string {
  return plainText(text)
    .replace(/[&<>]/g, (char) => HTML_ENTITIES[char] ?? char)
    .replace(/[\\`*_[\]|#~]/g, (char) => `\\${char}`)
}

const md = markdownText

/** A URL that cannot end an autolink early. Citation URLs are validated `https:` already. */
function autolinkUrl(url: string): string {
  return plainText(url).replace(/[<>\s]/g, (char) => encodeURIComponent(char))
}

function headerLines(report: Report): string[] {
  const { verdict, target, run } = report
  const endpoint =
    target.endpoint === null
      ? `\`${md(target.endpointHash)}\` (address hidden)`
      : md(target.endpoint)
  return [
    `# VerifAI report: ${HEADLINE_LABELS[verdict.headline]}`,
    '',
    `**Verdict:** ${HEADLINE_LABELS[verdict.headline]}, confidence ${percent(verdict.confidence)} (at most ${percent(verdict.confidenceCeiling)} for this run)`,
    '',
    `**In plain words:** ${md(verdict.plainLanguage)}`,
    '',
    `- **Claimed:** ${md(target.claimedModel)} (${VENDOR_NAMES[target.claimedVendor]}) over ${md(target.protocol)}, ${target.pairing} pairing`,
    ...(target.requestedModel === target.claimedModel
      ? []
      : [`- **Sold as:** ${md(target.requestedModel)}`]),
    `- **Endpoint:** ${endpoint}`,
    `- **Key sent as:** ${AUTH_TEXT[target.auth]}`,
    `- **Profile:** ${md(run.profile)}, ${md(run.startedAt)} to ${md(run.finishedAt)}`,
    `- **Tool:** VerifAI ${md(report.tool.version)}, report v${report.reportVersion}, fingerprints ${md(report.fingerprintsVersion)}`,
    ...(run.privateTargetsAllowed
      ? ['- **Note:** private network targets were allowed for this run']
      : []),
  ]
}

function findingLines(report: Report): string[] {
  const { assessment, epsilon, ceilingReasons } = report.verdict
  const consistency = epsilon === null ? '' : ` ${md(epsilonSummary(epsilon))}`
  const ceiling = ceilingReasons.map((reason) => `- ${CEILING_REASON_TEXT[reason]}`)
  return [
    '',
    '## Findings',
    '',
    '| Axis | Finding | Meaning |',
    '| --- | --- | --- |',
    `| identity | ${assessment.identity} | ${md(IDENTITY_TEXT[assessment.identity])} |`,
    `| consistency | ${assessment.consistency} | ${md(CONSISTENCY_TEXT[assessment.consistency])}.${consistency} |`,
    `| platform | ${assessment.platform} | ${md(PLATFORM_TEXT[assessment.platform])} |`,
    `| translation | ${assessment.translation} | ${md(TRANSLATION_TEXT[assessment.translation])} |`,
    `| evidence | ${assessment.evidence} | ${md(EVIDENCE_TEXT[assessment.evidence])} |`,
    ...(ceiling.length === 0
      ? []
      : ['', 'Confidence is held below certainty because:', '', ...ceiling]),
  ]
}

function signalLines(signal: Signal, numbers: readonly number[]): string[] {
  const refs = numbers.map((number) => `[^${number}]`).join('')
  return [
    `- **${md(signal.probeId)} / ${md(signal.signalId)}** (${signal.family}, ${signal.calibration})${refs}`,
    `  - Summary: ${md(signal.plainLanguage)}`,
    `  - Observed: ${md(signal.observed)}`,
    `  - Expected: ${md(signal.expected)}`,
    `  - Weight: ${md(weightOf(signal))}`,
  ]
}

function signalsSection(report: Report, notes: Footnotes): string[] {
  const body =
    report.signals.length === 0
      ? ['No probe produced a signal.']
      : report.signals.flatMap((signal, index) => signalLines(signal, notes.numbers[index] ?? []))
  return ['', `## Signals (${report.signals.length})`, '', ...body]
}

function skippedSection(report: Report): string[] {
  if (report.skipped.length === 0) {
    return []
  }
  const lines = report.skipped.map(
    (entry) => `- ${md(entry.probeId)}: ${SKIP_REASON_TEXT[entry.reason]}`,
  )
  return ['', `## Skipped (${report.skipped.length})`, '', ...lines]
}

function evidenceRow(entry: EvidenceEntry, index: number): string {
  const status =
    entry.status === null ? `none (${md(entry.failure ?? 'unknown')})` : String(entry.status)
  const total = entry.timing.totalMs === null ? '' : String(entry.timing.totalMs)
  const draw = entry.draw === undefined ? '' : String(entry.draw)
  return `| ${index + 1} | ${md(entry.probeId)} | ${status} | ${entry.sentAtMs} | ${total} | ${entry.connection} | ${draw} |`
}

function evidenceSection(report: Report): string[] {
  if (report.evidence.length === 0) {
    return ['', '## Evidence', '', 'No requests were sent.']
  }
  return [
    '',
    '## Evidence',
    '',
    `${md(evidenceSummary(report.evidence))}. Request and response digests are in the JSON report.`,
    '',
    '| # | Probe | Status | Sent at (ms) | Total (ms) | Connection | Draw |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.evidence.map(evidenceRow),
  ]
}

function sourcesSection(notes: Footnotes): string[] {
  return notes.sources.length === 0
    ? []
    : [
        '',
        ...notes.sources.map(
          (source, index) =>
            `[^${index + 1}]: <${autolinkUrl(source.url)}> "${md(source.quote)}" (read ${md(source.retrievedAt)})`,
        ),
      ]
}

export function renderMarkdown(report: Report): string {
  const notes = footnotesOf(report.signals)
  const lines = [
    ...headerLines(report),
    ...findingLines(report),
    ...signalsSection(report, notes),
    ...skippedSection(report),
    ...evidenceSection(report),
    '',
    '---',
    '',
    `_${DISCLAIMER}_`,
    ...sourcesSection(notes),
  ]
  return `${lines.join('\n')}\n`
}
