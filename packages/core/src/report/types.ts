/**
 * The report, as `docs/report-format.md` specifies it. The JSON document is
 * canonical; every renderer is a view of this and recomputes nothing in it.
 */

import type { AuthScheme } from '../adapters/types.js'
import type { Profile } from '../planner/profiles.js'
import type { DilutionBasis, Signal } from '../probes/types.js'
import type { DrawRecord, EvidenceEntry, SkippedProbe } from '../runner/types.js'
import type {
  Assessment,
  ConsistencyFinding,
  IdentityFinding,
  PlatformFinding,
  TranslationFinding,
  Verdict,
} from '../types/assessment.js'
import type { Pairing, Protocol, Vendor } from '../types/target.js'
import { type Member, vocabulary } from '../types/vocabulary.js'

export const REPORT_VERSION = 1

/** Why `confidenceCeiling` sits below the most any run may claim. */
export const CEILING_REASONS = vocabulary([
  'groups-b-c-not-run',
  'group-b-not-run',
  'group-c-not-run',
  'group-d-not-run',
  'cross-protocol',
  'probes-skipped',
  'calibration-documented-only',
])
export type CeilingReason = Member<typeof CEILING_REASONS>

export interface ReportRun {
  readonly startedAt: string
  readonly finishedAt: string
  readonly profile: Profile
  readonly spreadMs: number
  readonly nonce: string
  readonly probeOrderSeed: string
  readonly privateTargetsAllowed: boolean
}

export interface ReportTarget {
  /** `sha256:` over the normalised endpoint root. */
  readonly endpointHash: string
  /** Plaintext only when the buyer opted in. */
  readonly endpoint: string | null
  readonly protocol: Protocol
  readonly claimedVendor: Vendor
  /** The vendor's documented name for the model, which the checks compare against. */
  readonly claimedModel: string
  /** The name as the buyer typed it and the endpoint was asked for. */
  readonly requestedModel: string
  readonly pairing: Pairing
  /** How the buyer's key was sent. */
  readonly auth: AuthScheme
}

/**
 * The share of Group F repetitions that disagreed with `basis`, as Group F measured it. A
 * repetition is more than one request, so this is not the share of single requests.
 */
export interface Epsilon {
  readonly probeId: string
  readonly basis: DilutionBasis
  readonly disagreements: number
  /** `agree` plus `disagree` draws. */
  readonly trials: number
  readonly lost: number
  /** `null` when no draw could be read. */
  readonly estimate: number | null
  /** One-sided 95% bounds each way, widened by every lost draw. */
  readonly interval: readonly [number, number]
  /** Disagreements arrived in runs, as a router that pins backends for a while produces. */
  readonly clustered: boolean
  readonly draws: readonly DrawRecord[]
}

export interface ReportVerdict {
  /** Derived from `assessment` and `confidence` by `verdictFor`; never set directly. */
  readonly headline: Verdict
  readonly assessment: Assessment
  readonly confidence: number
  readonly confidenceCeiling: number
  readonly ceilingReasons: readonly CeilingReason[]
  readonly plainLanguage: string
  readonly epsilon: Epsilon | null
}

export interface Posteriors {
  readonly identity: Readonly<Record<IdentityFinding, number>>
  readonly consistency: Readonly<Record<ConsistencyFinding, number>>
  readonly platform: Readonly<Record<PlatformFinding, number>>
  readonly translation: Readonly<Record<TranslationFinding, number>>
}

export interface ReportSignature {
  readonly alg: 'Ed25519'
  readonly publicKey: string
  readonly keyFingerprint: string
  readonly value: string
}

export interface Report {
  readonly reportVersion: typeof REPORT_VERSION
  readonly tool: { readonly name: 'verifai'; readonly version: string }
  readonly fingerprintsVersion: string
  readonly run: ReportRun
  readonly target: ReportTarget
  readonly verdict: ReportVerdict
  readonly posteriors: Posteriors
  readonly signals: readonly Signal[]
  readonly skipped: readonly SkippedProbe[]
  readonly evidence: readonly EvidenceEntry[]
  /** Phase 8. */
  readonly signature?: ReportSignature
}
