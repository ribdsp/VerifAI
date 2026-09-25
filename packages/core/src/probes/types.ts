/**
 * The contract between a probe and the runner that executes it.
 *
 * A probe decides what to send and what the answer means. Everything else -
 * the key, retries, the budget, the evidence log, what counts as lost - is the
 * runner's, so a probe never sees a credential and cannot forget to record a
 * request. What a probe returns is a list of `Signal`s: observations with the
 * likelihood ratios they carry and the sources that define them.
 *
 * Two families are missing from `SIGNAL_FAMILIES` on purpose. A model's
 * statement about its own identity and the style of its prose are both easy to
 * fake and impossible to calibrate honestly, so neither has a family to be
 * registered under - see the hard guards in `docs/scoring.md`.
 */

import type { RequestBody } from '../adapters/adapter.js'
import type { Endpoint } from '../adapters/endpoint.js'
import type { AuthScheme } from '../adapters/types.js'
import type { Citation } from '../sources/citation.js'
import type { JsonBody } from '../transport/json-body.js'
import type {
  BodyChunk,
  ConnectionReuse,
  HeaderPair,
  HttpMethod,
  ResponseTiming,
} from '../transport/types.js'
import type { IdentityFinding, PlatformFinding, TranslationFinding } from '../types/assessment.js'
import type { Pairing, Protocol, Vendor } from '../types/target.js'
import { type Member, vocabulary } from '../types/vocabulary.js'

/**
 * A: protocol conformance and the validation layer. B: accounting and
 * identity. C: tokenizer forensics. D: causal capabilities. E: behaviour.
 * F: routing dilution, which runs as a `DilutionProbe`.
 */
export const PROBE_GROUPS = vocabulary(['A', 'B', 'C', 'D', 'E', 'F'])
export type ProbeGroup = Member<typeof PROBE_GROUPS>

export const SIGNAL_FAMILIES = vocabulary([
  'protocol-conformance',
  'accounting',
  'tokenizer',
  'causal-capability',
  'behavioral',
])
export type SignalFamily = Member<typeof SIGNAL_FAMILIES>

/** Strongest first. `docs/PROVENANCE.md` says what qualifies as each. */
export const CALIBRATIONS = vocabulary(['measured', 'documented', 'derived', 'heuristic'])
export type Calibration = Member<typeof CALIBRATIONS>

/**
 * log10 likelihood ratios, per finding, for each axis a signal bears on.
 * Positive favours the finding. `consistency` is absent: only the dispersion
 * test of Group F speaks to it, and `evidence` is the runner's own account.
 */
export interface LlrTable {
  readonly identity?: Readonly<Partial<Record<IdentityFinding, number>>>
  readonly platform?: Readonly<Partial<Record<PlatformFinding, number>>>
  readonly translation?: Readonly<Partial<Record<TranslationFinding, number>>>
}

export interface Signal {
  readonly probeId: string
  /** Stable within the probe, kebab-case. */
  readonly signalId: string
  readonly family: SignalFamily
  readonly calibration: Calibration
  /** What came back, stated as a fact. */
  readonly observed: string
  /** What the cited source says a genuine backend does. */
  readonly expected: string
  readonly llr: LlrTable
  /** For someone who is not an engineer. States facts, never intent. */
  readonly plainLanguage: string
  readonly citations: readonly [Citation, ...Citation[]]
  /**
   * Identity findings this observation is causally incompatible with, each
   * justified in the probe's provenance entry. Rare by construction.
   */
  readonly vetoes?: readonly IdentityFinding[]
}

/** Who the buyer says they bought from, and how they reach it. */
export interface ProbeTarget {
  readonly endpoint: Endpoint
  readonly protocol: Protocol
  readonly claimedVendor: Vendor
  /** The vendor's documented name for the model sold, which every fact is looked up under. */
  readonly claimedModel: string
  /**
   * The name as the buyer typed it, which every request carries. A gateway
   * that sells `claude-opus-4-6` as `reseller/claude-opus-4.6` takes only the
   * second; the vendor's catalog knows only the first.
   */
  readonly requestedModel: string
  readonly pairing: Pairing
  /**
   * How the buyer's key travels, when the buyer chose: a platform such as
   * Snowflake Cortex serves the Messages API but takes only a bearer token.
   * Each protocol's first documented scheme otherwise.
   */
  readonly auth?: AuthScheme
}

export interface ProbeRequest {
  /** An adapter's operation path, or `modelPath(id)`. */
  readonly path: string
  readonly method?: HttpMethod
  /**
   * `buyer` sends the buyer's key, which the runner holds and the probe never
   * sees; `none` sends no credential at all. Defaults to `buyer` when the run
   * has a key and to `none` when it does not.
   */
  readonly credential?: 'buyer' | 'none'
  readonly auth?: AuthScheme
  readonly body?: RequestBody
  readonly headers?: readonly HeaderPair[]
  readonly withoutHeaders?: readonly string[]
  /** Whose default headers to start from. The target's protocol when omitted. */
  readonly protocol?: Protocol
  readonly timeoutMs?: number
  readonly maxResponseBytes?: number
  /**
   * Statuses this request exists to provoke. A 401 or 403 listed here is the
   * finding rather than a stopped run or a lost probe.
   */
  readonly provokes?: readonly number[]
  /** Tokens this request may bill at most, counted against the budget. */
  readonly tokens?: number
  /** Whether this request asks the claimed model to generate. */
  readonly generates?: boolean
}

/** A response, as a probe reads it. Only complete HTTP responses become one. */
export interface Exchange {
  readonly status: number
  readonly statusText: string
  readonly httpVersion: string
  readonly headers: readonly HeaderPair[]
  readonly body: Uint8Array
  /** The body as UTF-8, or `undefined` when it is not valid UTF-8. */
  readonly text: string | undefined
  readonly json: JsonBody
  readonly chunks: readonly BodyChunk[]
  readonly timing: ResponseTiming
  readonly connection: ConnectionReuse
  /** Whether the runner had to send it twice. */
  readonly retried: boolean
}

export interface ProbeContext {
  readonly target: ProbeTarget
  readonly hasKey: boolean
  /** Random per run, `[a-z0-9]`, for payloads a proxy cannot precompute. */
  readonly nonce: string
  /**
   * Resolves with a complete response, including every error status. Rejects
   * with a runner error - lost, over budget, blocked, stopped - that the probe
   * lets through; the runner turns it into the right `skipped` entry.
   */
  readonly send: (request: ProbeRequest) => Promise<Exchange>
  /**
   * Computes a value once per run and shares it between probes, so two probes
   * that need the same baseline do not both pay for it. Keys are namespaced by
   * convention: `<probe-area>/<what>`.
   */
  readonly shared: <T>(key: string, compute: () => Promise<T>) => Promise<T>
  readonly signal: AbortSignal
}

interface ProbeCommon {
  /** The module path under `probes/`, without extension: `conformance/openai/route-serializers`. */
  readonly id: string
  readonly title: string
  /** Protocols the probe can speak to. */
  readonly protocols: readonly Protocol[]
  /** Claimed vendors it tests. */
  readonly vendors: readonly Vendor[]
  /** A finer applicability test than the two lists, such as a model family. */
  readonly applies?: (target: ProbeTarget) => boolean
  readonly needsKey: boolean
  /** Not run by any profile unless the buyer names it. */
  readonly optIn?: boolean
  /**
   * Upper bounds, used for the pre-flight estimate and the budget. A Group F
   * probe states one draw, or its preparation if that costs more; the planner
   * multiplies by the draws, their replacements and the preparation.
   */
  readonly cost: { readonly requests: number; readonly tokens: number }
  readonly citations: readonly [Citation, ...Citation[]]
}

export interface Probe extends ProbeCommon {
  readonly group: Exclude<ProbeGroup, 'F'>
  readonly run: (context: ProbeContext) => Promise<readonly Signal[]>
}

/** What one repetition of the dilution test found. */
export type DrawOutcome = 'agree' | 'disagree'

/** How a draw is judged: against a known answer, or against the run's own majority. */
export const DILUTION_BASES = vocabulary(['reference', 'mode'])
export type DilutionBasis = Member<typeof DILUTION_BASES>

/**
 * One deterministic, identity-revealing measurement, repeated. The runner owns
 * repetition, independence and loss; the probe only takes one reading.
 */
export interface DilutionProbe extends ProbeCommon {
  readonly group: 'F'
  /** Every request of one draw, for the independence check. */
  readonly requestsPerDraw: number
  /**
   * Chooses the basis and anything each draw needs, once. Rejecting with
   * `ProbeNotApplicable` skips the group rather than losing it.
   */
  readonly prepare: (context: ProbeContext) => Promise<DilutionPlan>
}

export interface DilutionPlan {
  readonly basis: DilutionBasis
  /** What the draws measure, for the report. */
  readonly measures: string
  /** Takes one reading. `undefined` when the answer could not be read: a lost draw. */
  readonly read: (context: ProbeContext) => Promise<string | undefined>
  /** With a `reference` basis: the reading the claimed model gives. */
  readonly reference?: string
  /**
   * Signals to emit once the draws are in, given the readings in order. Used
   * for the identity reading a uniform run supports.
   */
  readonly conclude: (readings: readonly string[]) => readonly Signal[]
}

export type AnyProbe = Probe | DilutionProbe

export function isDilutionProbe(probe: AnyProbe): probe is DilutionProbe {
  return probe.group === 'F'
}
