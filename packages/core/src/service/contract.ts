/**
 * The HTTP contract between `verifai web`'s local daemon and the SPA it serves.
 *
 * Both halves import this file, so a field renamed on one side is a type error
 * on the other. Requests are validated here with schemas the daemon applies
 * before anything else; responses are the daemon's own and are typed rather
 * than re-validated. All JSON is camelCase.
 *
 * A validation problem names the field and what it expected, never what it
 * received: the body carries an API key, and a message that quoted a rejected
 * value could quote the key.
 */

import * as v from 'valibot'
import { MAX_ENDPOINT_LENGTH } from '../adapters/endpoint.js'
import { MAX_MODEL_ID_LENGTH } from '../adapters/model.js'
import { AUTH_SCHEMES, type AuthScheme } from '../adapters/types.js'
import { MAX_API_KEY_LENGTH } from '../credentials/api-key.js'
import {
  MAX_REQUESTS_LIMIT,
  MAX_SPREAD_MS,
  MAX_TOKENS_LIMIT,
  PROFILES,
  type Profile,
} from '../planner/profiles.js'
import type { ProbeGroup } from '../probes/types.js'
import type { Report } from '../report/types.js'
import type { RunEvent, SkippedProbe } from '../runner/types.js'
import { type Pairing, PROTOCOLS, type Protocol, type Vendor } from '../types/target.js'
import { type Member, vocabulary } from '../types/vocabulary.js'

export const API_PATHS = Object.freeze({
  health: '/api/health',
  options: '/api/options',
  checks: '/api/checks',
})

/** The SPA reads its session token from this fragment key: `/#token=<token>`. */
export const TOKEN_FRAGMENT_KEY = 'token'

/** How often the SPA asks for progress. */
export const POLL_INTERVAL_MS = 500

export const VENDOR_CHOICES = vocabulary(['auto', 'anthropic', 'openai'])
export type VendorChoice = Member<typeof VENDOR_CHOICES>

export const PROTOCOL_CHOICES = vocabulary(['auto', ...PROTOCOLS.values])
export type ProtocolChoice = Member<typeof PROTOCOL_CHOICES>

/** `auto` sends the key the way each protocol's vendor documents first. */
export const AUTH_CHOICES = vocabulary(['auto', ...AUTH_SCHEMES.values])
export type AuthChoice = Member<typeof AUTH_CHOICES>

/**
 * Slack above the longest key `normaliseApiKey` accepts, for the whitespace a
 * paste brings along. The key's own checks happen there, not here.
 */
const MAX_API_KEY_INPUT = MAX_API_KEY_LENGTH + 64

const boundedInteger = (min: number, max: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max))

export const CREATE_CHECK_SCHEMA = v.strictObject({
  endpoint: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_ENDPOINT_LENGTH)),
  apiKey: v.optional(v.pipe(v.string(), v.maxLength(MAX_API_KEY_INPUT))),
  model: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_MODEL_ID_LENGTH)),
  vendor: v.picklist(VENDOR_CHOICES.values),
  protocol: v.picklist(PROTOCOL_CHOICES.values),
  profile: v.picklist(PROFILES.values),
  auth: v.optional(v.picklist(AUTH_CHOICES.values)),
  maxRequests: v.optional(boundedInteger(1, MAX_REQUESTS_LIMIT)),
  maxTokens: v.optional(boundedInteger(0, MAX_TOKENS_LIMIT)),
  spreadMs: v.optional(boundedInteger(0, MAX_SPREAD_MS)),
  allowPrivateTargets: v.optional(v.boolean()),
  showEndpoint: v.optional(v.boolean()),
})

/** What a check is asked to do. The CLI builds the same object from its flags. */
export type CheckRequest = v.InferOutput<typeof CREATE_CHECK_SCHEMA>

const FIELDS: ReadonlySet<string> = new Set(Object.keys(CREATE_CHECK_SCHEMA.entries))

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly string[] }

function fieldOf(issue: v.BaseIssue<unknown>): string {
  const key = issue.path?.[0]?.key
  if (key === undefined) {
    return 'body'
  }
  // An unknown key is named only when it is one of ours, which it never is;
  // anything else could be whatever the client put there, including a key.
  return typeof key === 'string' && FIELDS.has(key) ? key : 'unknown field'
}

function problemOf(issue: v.BaseIssue<unknown>): string {
  const field = fieldOf(issue)
  if (field === 'unknown field') {
    return 'unknown field: not part of the request'
  }
  return issue.expected === null ? `${field}: invalid` : `${field}: expected ${issue.expected}`
}

export function parseCheckRequest(input: unknown): ParseResult<CheckRequest> {
  const result = v.safeParse(CREATE_CHECK_SCHEMA, input)
  if (result.success) {
    return Object.freeze({ ok: true, value: Object.freeze(result.output) })
  }
  const problems = [...new Set(result.issues.map(problemOf))]
  return Object.freeze({ ok: false, problems: Object.freeze(problems) })
}

export const CHECK_STATES = vocabulary([
  /** Planned and estimated; waiting for the buyer to confirm. */
  'prepared',
  'running',
  /** A report was issued. */
  'finished',
  /** The endpoint said the key or the model is wrong, or could not be reached. No report. */
  'stopped',
  /** VerifAI failed. No report. */
  'failed',
  'cancelled',
])
export type CheckState = Member<typeof CHECK_STATES>

/** States a check never leaves. */
export const FINAL_CHECK_STATES = vocabulary([
  'finished',
  'stopped',
  'failed',
  'cancelled',
] as const satisfies readonly CheckState[])

export const API_ERROR_CODES = vocabulary([
  'invalid-request',
  'invalid-endpoint',
  'invalid-api-key',
  'invalid-model',
  'blocked-target',
  'detection-failed',
  'not-found',
  'conflict',
  'busy',
  'unauthorized',
  'forbidden',
  'method-not-allowed',
  'payload-too-large',
  'unsupported-media-type',
  'rate-limited',
  'invalid-key',
  'model-not-found',
  'unreachable',
  'internal',
])
export type ApiErrorCode = Member<typeof API_ERROR_CODES>

export interface ApiError {
  readonly code: ApiErrorCode
  /** Fixed text per code, or problems naming fields. Never a value the client sent. */
  readonly message: string
}

export interface ApiErrorResponse {
  readonly error: ApiError
}

export interface HealthResponse {
  readonly ok: true
  readonly version: string
}

export interface ProfileOption {
  readonly profile: Profile
  readonly description: string
  readonly groups: readonly ProbeGroup[]
  readonly draws: number
  readonly spreadMs: number
  readonly maxRequests: number
  readonly maxTokens: number
}

export interface OptionsResponse {
  readonly version: string
  readonly profiles: readonly ProfileOption[]
  readonly vendors: readonly VendorChoice[]
  readonly protocols: readonly ProtocolChoice[]
  readonly authChoices: readonly AuthChoice[]
  readonly defaults: {
    readonly profile: Profile
    readonly vendor: VendorChoice
    readonly protocol: ProtocolChoice
    readonly auth: AuthChoice
  }
  readonly limits: {
    readonly maxRequests: number
    readonly maxTokens: number
    readonly maxSpreadMs: number
    readonly maxEndpointLength: number
    readonly maxModelLength: number
  }
}

export const ESTIMATE_WARNINGS = vocabulary([
  /** The endpoint is plain `http:`: the key crosses the network in the clear. */
  'plain-http',
  /** The claimed model is served over the other vendor's protocol. */
  'cross-protocol',
  /** No key: only the probes that need none will run. */
  'no-api-key',
  /** The buyer admitted private addresses for this run. */
  'private-targets-allowed',
  /** The protocol was detected rather than given. */
  'protocol-detected',
  /** The model name was read as the vendor's name it decorates, as `reseller/claude-opus-4.6`. */
  'model-mapped',
  /** The vendor was read from the model name rather than given. */
  'vendor-inferred',
  /** This transport cannot open a fresh connection per request, so Group F will not run. */
  'dilution-unsupported',
  /** The budget leaves out probes the profile would run. */
  'budget-limited',
])
export type EstimateWarning = Member<typeof ESTIMATE_WARNINGS>

export interface PlannedProbe {
  readonly id: string
  readonly title: string
  readonly group: ProbeGroup
}

export interface CheckEstimate {
  readonly protocol: Protocol
  readonly vendor: Vendor
  readonly pairing: Pairing
  /** How the key will be sent. */
  readonly auth: AuthScheme
  readonly profile: Profile
  /** Upper bounds for the planned probes. */
  readonly requests: number
  readonly tokens: number
  readonly maxRequests: number
  readonly maxTokens: number
  /** Group F repetitions; 0 when Group F does not run. */
  readonly draws: number
  /** How long the Group F draws are spread over. */
  readonly spreadMs: number
  readonly probes: readonly PlannedProbe[]
  readonly skipped: readonly SkippedProbe[]
  readonly warnings: readonly EstimateWarning[]
}

export interface CreateCheckResponse {
  readonly checkId: string
  readonly estimate: CheckEstimate
}

export interface CheckEvent {
  /** From 0, in the order the events happened. */
  readonly seq: number
  readonly event: RunEvent
}

export interface CheckProgress {
  readonly done: number
  readonly total: number
  readonly requests: number
  readonly tokens: number
}

export interface CheckStatusResponse {
  readonly checkId: string
  readonly state: CheckState
  readonly progress: CheckProgress
  /** The events from `?since=` on. */
  readonly events: readonly CheckEvent[]
  /** What to pass as `since` next time. */
  readonly nextEvent: number
  readonly report?: Report
  readonly error?: ApiError
}

export const REPORT_FORMATS = vocabulary(['json', 'markdown'])
export type ReportFormat = Member<typeof REPORT_FORMATS>
