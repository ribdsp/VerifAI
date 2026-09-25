/**
 * The default view: the buyer's verdict first, then the signal table with
 * citations as footnotes.
 *
 * Colour is injected, not imported, so core stays free of terminal
 * dependencies and a test can read the output without escape codes. Whatever
 * the style adds, every value from the report is first passed through
 * `plainText`, so an endpoint cannot smuggle its own escape sequences in.
 */

import type { Signal } from '../probes/types.js'
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
  type Stance,
  stanceOf,
  weightOf,
} from './text.js'
import type { Report } from './types.js'

type Paint = (text: string) => string

export interface TerminalStyle {
  readonly pass: Paint
  readonly caution: Paint
  readonly fail: Paint
  readonly supports: Paint
  readonly against: Paint
  readonly context: Paint
  readonly bold: Paint
  readonly dim: Paint
}

const unchanged: Paint = (text) => text

export const PLAIN_STYLE: TerminalStyle = Object.freeze({
  pass: unchanged,
  caution: unchanged,
  fail: unchanged,
  supports: unchanged,
  against: unchanged,
  context: unchanged,
  bold: unchanged,
  dim: unchanged,
})

/** Words, not marks: a lone `+` or `!` says nothing to someone who has not read the source. */
const STANCE_WORDS: Readonly<Record<Stance, string>> = Object.freeze({
  supports: 'for',
  against: 'against',
  context: 'neutral',
})
const STANCE_WIDTH = Math.max(...Object.values(STANCE_WORDS).map((word) => word.length))
const STANCE_LEGEND = 'Each leans for or against the claimed model, or is neutral.'

const INDENT = '  '
const LABEL_WIDTH = 13

function row(label: string, value: string): string {
  return `${INDENT}${label.padEnd(LABEL_WIDTH)}${plainText(value)}`
}

function headerLines(report: Report, style: TerminalStyle): string[] {
  const { verdict, target, run } = report
  const paint = style[verdict.headline]
  const claim = `${target.claimedModel} (${VENDOR_NAMES[target.claimedVendor]}) over ${target.protocol}, ${target.pairing} pairing`
  const endpoint = target.endpoint ?? `${target.endpointHash} (address hidden)`
  return [
    style.dim(
      plainText(
        `VerifAI ${report.tool.version} · report v${report.reportVersion} · fingerprints ${report.fingerprintsVersion}`,
      ),
    ),
    '',
    `${INDENT}${style.bold(paint(` ${HEADLINE_LABELS[verdict.headline]} `))}  confidence ${percent(verdict.confidence)} (at most ${percent(verdict.confidenceCeiling)} for this run)`,
    `${INDENT}${plainText(verdict.plainLanguage)}`,
    '',
    row('Claimed', claim),
    ...(target.requestedModel === target.claimedModel
      ? []
      : [row('Sold as', target.requestedModel)]),
    row('Endpoint', endpoint),
    row('Key sent as', AUTH_TEXT[target.auth]),
    row('Profile', `${run.profile}, ${run.startedAt} to ${run.finishedAt}`),
    ...(run.privateTargetsAllowed
      ? [row('Note', 'private network targets were allowed for this run')]
      : []),
  ]
}

function findingLines(report: Report, style: TerminalStyle): string[] {
  const { assessment, epsilon, ceilingReasons } = report.verdict
  const consistency = CONSISTENCY_TEXT[assessment.consistency]
  const lines = [
    '',
    `${INDENT}${style.bold('Findings')}`,
    row('identity', `${assessment.identity}: ${IDENTITY_TEXT[assessment.identity]}`),
    row('consistency', `${assessment.consistency}: ${consistency}`),
    ...(epsilon === null ? [] : [row('', epsilonSummary(epsilon))]),
    row('platform', `${assessment.platform}: ${PLATFORM_TEXT[assessment.platform]}`),
    row('translation', `${assessment.translation}: ${TRANSLATION_TEXT[assessment.translation]}`),
    row('evidence', `${assessment.evidence}: ${EVIDENCE_TEXT[assessment.evidence]}`),
  ]
  const ceiling = ceilingReasons.map((reason) => row('', `- ${CEILING_REASON_TEXT[reason]}`))
  return ceiling.length === 0
    ? lines
    : [...lines, row('Held below', 'certainty because'), ...ceiling]
}

function signalLines(signal: Signal, numbers: readonly number[], style: TerminalStyle): string[] {
  const stance = stanceOf(signal)
  const word = STANCE_WORDS[stance]
  const lean = `${style[stance](word)}${' '.repeat(STANCE_WIDTH - word.length)}`
  const refs = numbers.map((number) => `[${number}]`).join('')
  // The detail lines start under the probe id, clear of the stance column.
  const pad = `${INDENT}${' '.repeat(STANCE_WIDTH + 2)}`
  return [
    `${INDENT}${lean}  ${plainText(`${signal.probeId} / ${signal.signalId}`)} ${style.dim(plainText(`(${signal.family}, ${signal.calibration})`))} ${refs}`,
    `${pad}${plainText(signal.plainLanguage)}`,
    `${pad}${style.dim('observed')} ${plainText(signal.observed)}`,
    `${pad}${style.dim('expected')} ${plainText(signal.expected)}`,
    `${pad}${style.dim('weight')}   ${plainText(weightOf(signal))}`,
  ]
}

function signalsSection(report: Report, notes: Footnotes, style: TerminalStyle): string[] {
  const title = `${INDENT}${style.bold(`Signals (${report.signals.length})`)}`
  if (report.signals.length === 0) {
    return ['', title, `${INDENT}No probe produced a signal.`]
  }
  const body = report.signals.flatMap((signal, index) =>
    signalLines(signal, notes.numbers[index] ?? [], style),
  )
  return ['', title, `${INDENT}${style.dim(STANCE_LEGEND)}`, ...body]
}

function skippedSection(report: Report, style: TerminalStyle): string[] {
  if (report.skipped.length === 0) {
    return []
  }
  const lines = report.skipped.map((entry) =>
    row('', `${plainText(entry.probeId)}: ${SKIP_REASON_TEXT[entry.reason]}`),
  )
  return ['', `${INDENT}${style.bold(`Skipped (${report.skipped.length})`)}`, ...lines]
}

function sourcesSection(notes: Footnotes, style: TerminalStyle): string[] {
  if (notes.sources.length === 0) {
    return []
  }
  const lines = notes.sources.flatMap((source, index) => [
    `${INDENT}[${index + 1}] ${plainText(source.url)}`,
    `${INDENT}    "${plainText(source.quote)}" ${style.dim(`(read ${plainText(source.retrievedAt)})`)}`,
  ])
  return ['', `${INDENT}${style.bold('Sources')}`, ...lines]
}

export function renderTerminal(report: Report, style: TerminalStyle = PLAIN_STYLE): string {
  const notes = footnotesOf(report.signals)
  const lines = [
    ...headerLines(report, style),
    ...findingLines(report, style),
    ...signalsSection(report, notes, style),
    ...skippedSection(report, style),
    '',
    row('Evidence', evidenceSummary(report.evidence)),
    ...sourcesSection(notes, style),
    '',
    style.dim(DISCLAIMER),
  ]
  return `${lines.join('\n')}\n`
}
