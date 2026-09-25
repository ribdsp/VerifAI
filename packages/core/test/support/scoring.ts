/** Builders for scoring tests: signals, outcomes and draws with nothing but what the case needs. */

import type {
  Calibration,
  LlrTable,
  ProbeGroup,
  Signal,
  SignalFamily,
} from '../../src/probes/types.js'
import type { DilutionRun, DrawRecord, ProbeOutcome, SkipReason } from '../../src/runner/types.js'
import type { IdentityFinding } from '../../src/types/assessment.js'

const CITATION = {
  url: 'https://platform.claude.com/docs/en/api/messages',
  quote: 'A test quote.',
  retrievedAt: '2026-09-01',
} as const

let counter = 0

export interface SignalSpec {
  readonly family?: SignalFamily
  readonly calibration?: Calibration
  readonly llr: LlrTable
  readonly vetoes?: readonly IdentityFinding[]
}

export function signal(spec: SignalSpec): Signal {
  counter += 1
  return {
    probeId: `test/probe-${counter}`,
    signalId: 'reading',
    family: spec.family ?? 'protocol-conformance',
    calibration: spec.calibration ?? 'measured',
    observed: 'observed',
    expected: 'expected',
    llr: spec.llr,
    plainLanguage: 'A test reading.',
    citations: [CITATION],
    ...(spec.vetoes === undefined ? {} : { vetoes: spec.vetoes }),
  }
}

/** Every probe in `groups` ran, one each unless `count` says otherwise. */
export function ran(groups: string, count = 1): ProbeOutcome[] {
  return [...groups].flatMap((group) =>
    Array.from({ length: count }, (_, index) => ({
      probeId: `${group.toLowerCase()}/ran-${index}`,
      group: group as ProbeGroup,
      status: 'ran' as const,
    })),
  )
}

export function skipped(groups: string, reason: SkipReason, count = 1): ProbeOutcome[] {
  return [...groups].flatMap((group) =>
    Array.from({ length: count }, (_, index) => ({
      probeId: `${group.toLowerCase()}/${reason}-${index}`,
      group: group as ProbeGroup,
      status: 'skipped' as const,
      reason,
    })),
  )
}

/** Draws from letters: a agree, d disagree, l lost, x excluded. */
export function draws(outcomes: string): DilutionRun {
  const names = { a: 'agree', d: 'disagree', l: 'lost', x: 'excluded' } as const
  const records: DrawRecord[] = [...outcomes].map((letter, index) => ({
    draw: index + 1,
    outcome: names[letter as keyof typeof names],
  }))
  return {
    probeId: 'dilution/test',
    basis: 'reference',
    measures: 'a test reading',
    requestsPerDraw: 2,
    draws: records,
    readings: [],
    planned: records.length,
    spreadMs: 0,
  }
}
