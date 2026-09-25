/**
 * What a run produces, before any of it is scored.
 *
 * Everything here is a record of what happened, in the order it happened. The
 * scoring reads it; the report publishes it; `verifai verify` checks the one
 * against the other. None of it carries a body or a key: requests and
 * responses are kept as digests.
 */

import type { DilutionBasis, ProbeGroup, Signal } from '../probes/types.js'
import type { ConnectionReuse, TransportFailureKind } from '../transport/types.js'
import { type Member, vocabulary } from '../types/vocabulary.js'

/**
 * Why a probe did not run, or did not finish.
 *
 * Only some of these are gaps in the evidence - see `GAP_REASONS`. The others
 * say the probe had nothing to measure here, or was never asked to.
 */
export const SKIP_REASONS = vocabulary([
  /** The probe does not apply to this protocol, vendor or model. */
  'not-applicable',
  /** It needs the buyer's key and the run has none. */
  'needs-api-key',
  /** Running it would pass the request or token budget. */
  'budget-exceeded',
  /** The endpoint failed it twice, or refused it with a 403. Counted toward `obstructed`. */
  'endpoint-error',
  /** The transport cannot give it what it needs: a fresh connection per request. */
  'unsupported-by-transport',
  /** The transport refused the endpoint's address. */
  'blocked',
  /** Only run when the buyer names it. */
  'opt-in',
  /** The run was cancelled first. */
  'aborted',
  /** Not part of the chosen profile. */
  'profile',
  /** The probe itself failed. A bug in VerifAI, never a finding about the endpoint. */
  'probe-error',
])
export type SkipReason = Member<typeof SKIP_REASONS>

/**
 * Reasons that leave a hole in what the run established, and so lower the
 * confidence ceiling. A probe the profile left out is accounted for by the
 * group coverage instead, and one that does not apply was never evidence.
 */
export const GAP_REASONS = vocabulary([
  'needs-api-key',
  'budget-exceeded',
  'endpoint-error',
  'unsupported-by-transport',
  'blocked',
  'aborted',
  'probe-error',
] as const satisfies readonly SkipReason[])

export interface SkippedProbe {
  readonly probeId: string
  readonly reason: SkipReason
}

export interface EvidenceTiming {
  /** From the request going out to the first byte of the body. */
  readonly ttftMs: number | null
  readonly totalMs: number | null
  /** Filled only by probes that count streamed tokens. */
  readonly tokensPerSecond: number | null
}

/** One request as it went out, and what came back. */
export interface EvidenceEntry {
  readonly probeId: string
  /** `sha256:` over method, URL, headers with the key redacted, and body. */
  readonly requestDigest: string
  /** `sha256:` over the response body; `null` when no response arrived. */
  readonly responseDigest: string | null
  /** `null` when no response arrived. */
  readonly status: number | null
  /** Why no response arrived. */
  readonly failure?: TransportFailureKind
  /** When it went out, from the start of the run. */
  readonly sentAtMs: number
  readonly timing: EvidenceTiming
  readonly connection: ConnectionReuse
  /** The Group F repetition this request belongs to. */
  readonly draw?: number
  /** Whether this was the runner's one retry of the request before it. */
  readonly retry?: boolean
}

export const DRAW_OUTCOMES = vocabulary(['agree', 'disagree', 'lost', 'excluded'])
export type DrawRecordOutcome = Member<typeof DRAW_OUTCOMES>

export interface DrawRecord {
  /** From 1, in the order sent. */
  readonly draw: number
  readonly outcome: DrawRecordOutcome
}

/** What the Group F probe did. */
export interface DilutionRun {
  readonly probeId: string
  readonly basis: DilutionBasis
  readonly measures: string
  readonly requestsPerDraw: number
  /** Every repetition, in the order sent. */
  readonly draws: readonly DrawRecord[]
  /** The readings of the `agree` and `disagree` draws, in the same order. */
  readonly readings: readonly string[]
  /** The repetitions asked for. */
  readonly planned: number
  readonly spreadMs: number
}

export interface ProbeOutcome {
  readonly probeId: string
  readonly group: ProbeGroup
  /** `ran`: the probe finished, with or without signals. */
  readonly status: 'ran' | 'skipped'
  readonly reason?: SkipReason
}

export interface RunResult {
  readonly signals: readonly Signal[]
  /** Every probe that did not run, or did not finish, with why. */
  readonly skipped: readonly SkippedProbe[]
  /** In send order. */
  readonly evidence: readonly EvidenceEntry[]
  /** One per planned or skipped probe, in the order decided. */
  readonly outcomes: readonly ProbeOutcome[]
  readonly dilution: DilutionRun | undefined
  readonly aborted: boolean
  readonly requests: number
  readonly tokens: number
}

/** Progress, for a terminal or the web UI. Never carries a body or a key. */
export type RunEvent =
  | {
      readonly kind: 'probe-started'
      readonly probeId: string
      readonly index: number
      readonly total: number
    }
  | {
      readonly kind: 'probe-finished'
      readonly probeId: string
      readonly status: 'ran' | 'skipped'
      readonly reason?: SkipReason
      readonly signals: number
    }
  | { readonly kind: 'request'; readonly probeId: string; readonly status: number | null }
  | { readonly kind: 'waiting'; readonly probeId: string; readonly waitMs: number }
  | { readonly kind: 'draw'; readonly draw: number; readonly outcome: DrawRecordOutcome }
  | { readonly kind: 'probe-error'; readonly probeId: string; readonly message: string }
