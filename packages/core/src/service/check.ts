/**
 * A check, from the buyer's request to a finished report.
 *
 * `prepareCheck` does everything that costs nothing - validation, protocol
 * detection, planning - and hands back the estimate for the buyer to accept.
 * `execute` then runs the plan, scores it and builds the report. The two are
 * split so the CLI can ask "spend this much?" and the web UI can show the same
 * estimate before a single paid request is sent.
 *
 * The API key lives in the closure of the prepared check and nowhere else. It
 * is not a property of anything returned, and it is dropped the moment the
 * check runs or is discarded, so a check that was prepared and abandoned does
 * not keep a key alive.
 */

import { FINGERPRINTS_VERSION } from '@verifai/fingerprints'
import { adapterFor, targetAuth } from '../adapters/adapter.js'
import { createRedactor } from '../credentials/redact.js'
import { type ProbePlan, planProbes } from '../planner/plan.js'
import { PROBE_CATALOGUE } from '../probes/registry.js'
import type { AnyProbe, ProbeTarget } from '../probes/types.js'
import { buildReport } from '../report/build.js'
import type { Report } from '../report/types.js'
import { RunStopped } from '../runner/errors.js'
import { runProbes } from '../runner/run.js'
import type { RunEnvironment } from '../runner/session.js'
import type { RunEvent, RunResult } from '../runner/types.js'
import { assess } from '../scoring/assess.js'
import type { Transport } from '../transport/types.js'
import type { ApiError, CheckEstimate, CheckRequest, EstimateWarning } from './contract.js'
import { randomId } from './random.js'
import { resolveTarget } from './target.js'

/** Long enough that a nonce is never guessed ahead of the run. */
const NONCE_LENGTH = 24

const INTERNAL_MESSAGE =
  'The check failed inside VerifAI. Nothing was concluded about the endpoint.'

export interface CheckEnvironment {
  readonly transport: Transport
  /** Whether the transport opens a fresh connection per request, as Group F needs. */
  readonly dilutionSupported: boolean
  readonly toolVersion: string
  /** Every probe VerifAI has, unless a test narrows it. */
  readonly catalogue?: readonly AnyProbe[]
  /** Fresh ids for the nonce and the order seed. */
  readonly randomId?: (length: number) => string
  readonly signal?: AbortSignal
}

export interface ExecuteOptions {
  readonly signal?: AbortSignal
  readonly onEvent?: (event: RunEvent) => void
  /** Wall-clock milliseconds, for the report's start and finish. */
  readonly now?: () => number
  readonly environment?: Partial<RunEnvironment>
}

export type CheckOutcome =
  | {
      readonly state: 'finished'
      readonly report: Report
      readonly requests: number
      readonly tokens: number
    }
  | { readonly state: 'cancelled'; readonly requests: number; readonly tokens: number }
  /**
   * The endpoint refused in a way that ends a check: no key, no model, no answer.
   * `suggestsBearer` when the key was refused as `x-api-key` by a protocol that
   * also takes it as a bearer token; the message then says so in `BEARER_HINT`.
   */
  | { readonly state: 'stopped'; readonly error: ApiError; readonly suggestsBearer: boolean }
  /** VerifAI broke. `detail` is redacted and for a log, never for the buyer. */
  | { readonly state: 'failed'; readonly error: ApiError; readonly detail: string }

export interface PreparedCheck {
  readonly estimate: CheckEstimate
  readonly plan: ProbePlan
  readonly target: ProbeTarget
  /** Runs once. A second call, or a call after `discard`, rejects. */
  readonly execute: (options?: ExecuteOptions) => Promise<CheckOutcome>
  /** Drops the key without running. */
  readonly discard: () => void
}

export type Preparation =
  | { readonly ok: true; readonly check: PreparedCheck }
  | { readonly ok: false; readonly error: ApiError }

function planWarnings(plan: ProbePlan): EstimateWarning[] {
  return [
    ...(plan.dilutionUnsupported ? (['dilution-unsupported'] as const) : []),
    ...(plan.budgetLimited ? (['budget-limited'] as const) : []),
  ]
}

function estimateOf(
  target: ProbeTarget,
  plan: ProbePlan,
  warnings: readonly EstimateWarning[],
): CheckEstimate {
  return Object.freeze({
    protocol: target.protocol,
    vendor: target.claimedVendor,
    pairing: target.pairing,
    auth: targetAuth(target),
    profile: plan.profile,
    requests: plan.requests,
    tokens: plan.tokens,
    maxRequests: plan.maxRequests,
    maxTokens: plan.maxTokens,
    draws: plan.draws,
    spreadMs: plan.spreadMs,
    probes: Object.freeze(
      plan.probes.map(({ id, title, group }) => Object.freeze({ id, title, group })),
    ),
    skipped: plan.skipped,
    warnings: Object.freeze([...warnings]),
  })
}

/** The planner's refusals come first, as they were decided first. */
function withPlanSkips(result: RunResult, plan: ProbePlan): RunResult {
  return Object.freeze({
    ...result,
    skipped: Object.freeze([...plan.skipped, ...result.skipped]),
    outcomes: Object.freeze([...plan.outcomes, ...result.outcomes]),
  })
}

interface Execution {
  readonly target: ProbeTarget
  readonly plan: ProbePlan
  readonly apiKey: string | undefined
  readonly transport: Transport
  readonly toolVersion: string
  readonly nonce: string
  readonly privateTargetsAllowed: boolean
  readonly showEndpoint: boolean
}

/** Added to a refused key that travelled as `x-api-key` where a bearer token could have. */
export const BEARER_HINT =
  'Some platforms that serve the Messages API, such as Snowflake Cortex, take the key only as a bearer token: try again with the key sent as a bearer token.'

function suggestsBearer(error: RunStopped, target: ProbeTarget): boolean {
  return (
    error.reason === 'invalid-key' &&
    targetAuth(target) !== 'bearer' &&
    adapterFor(target.protocol).authSchemes.includes('bearer')
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'non-error thrown'
}

async function run(execution: Execution, options: ExecuteOptions): Promise<CheckOutcome> {
  const { target, plan, apiKey } = execution
  const now = options.now ?? Date.now
  const startedAt = new Date(now()).toISOString()
  const raw = await runProbes({
    target,
    transport: execution.transport,
    probes: plan.probes,
    maxRequests: plan.maxRequests,
    maxTokens: plan.maxTokens,
    nonce: execution.nonce,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(plan.draws > 0 ? { draws: plan.draws, spreadMs: plan.spreadMs } : {}),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
  })
  if (raw.aborted) {
    return Object.freeze({ state: 'cancelled', requests: raw.requests, tokens: raw.tokens })
  }
  const result = withPlanSkips(raw, plan)
  const scored = assess({
    signals: result.signals,
    outcomes: result.outcomes,
    dilution: result.dilution,
    pairing: target.pairing,
  })
  const report = await buildReport({
    toolVersion: execution.toolVersion,
    fingerprintsVersion: FINGERPRINTS_VERSION,
    run: Object.freeze({
      startedAt,
      finishedAt: new Date(now()).toISOString(),
      profile: plan.profile,
      spreadMs: plan.spreadMs,
      nonce: execution.nonce,
      probeOrderSeed: plan.orderSeed,
      privateTargetsAllowed: execution.privateTargetsAllowed,
    }),
    target,
    showEndpoint: execution.showEndpoint,
    result,
    scored,
    secrets: apiKey === undefined ? [] : [apiKey],
  })
  return Object.freeze({
    state: 'finished',
    report,
    requests: result.requests,
    tokens: result.tokens,
  })
}

async function settle(execution: Execution, options: ExecuteOptions): Promise<CheckOutcome> {
  try {
    return await run(execution, options)
  } catch (error: unknown) {
    if (error instanceof RunStopped) {
      const bearer = suggestsBearer(error, execution.target)
      return Object.freeze({
        state: 'stopped',
        error: Object.freeze({
          code: error.reason,
          message: bearer ? `${error.message} ${BEARER_HINT}` : error.message,
        }),
        suggestsBearer: bearer,
      })
    }
    const secrets = execution.apiKey === undefined ? [] : [execution.apiKey]
    return Object.freeze({
      state: 'failed',
      error: Object.freeze({ code: 'internal', message: INTERNAL_MESSAGE }),
      detail: createRedactor(secrets)(describe(error)),
    })
  }
}

/** Holds the key until the check runs or is dropped, then forgets it. */
function preparedCheck(
  execution: Omit<Execution, 'apiKey'>,
  apiKey: string | undefined,
  estimate: CheckEstimate,
): PreparedCheck {
  let key = apiKey
  let spent = false
  const execute = (options: ExecuteOptions = {}): Promise<CheckOutcome> => {
    if (spent) {
      return Promise.reject(new Error('A prepared check runs once'))
    }
    spent = true
    const held = key
    key = undefined
    return settle({ ...execution, apiKey: held }, options)
  }
  const discard = () => {
    spent = true
    key = undefined
  }
  return Object.freeze({
    estimate,
    plan: execution.plan,
    target: execution.target,
    execute,
    discard,
  })
}

/**
 * Validates, detects and plans. Resolves for every refusal, with the error the
 * buyer sees; rejects only for a transport that rejects.
 */
export async function prepareCheck(
  request: CheckRequest,
  env: CheckEnvironment,
): Promise<Preparation> {
  const resolution = await resolveTarget(request, env.transport, env.signal)
  if (!resolution.ok) {
    return resolution
  }
  const { target, apiKey, warnings } = resolution.value
  const draw = env.randomId ?? randomId
  const plan = planProbes({
    target,
    profile: request.profile,
    hasKey: apiKey !== undefined,
    catalogue: env.catalogue ?? PROBE_CATALOGUE,
    dilutionSupported: env.dilutionSupported,
    orderSeed: draw(NONCE_LENGTH),
    ...(request.maxRequests === undefined ? {} : { maxRequests: request.maxRequests }),
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(request.spreadMs === undefined ? {} : { spreadMs: request.spreadMs }),
  })
  const estimate = estimateOf(target, plan, [...warnings, ...planWarnings(plan)])
  const execution = {
    target,
    plan,
    transport: env.transport,
    toolVersion: env.toolVersion,
    nonce: draw(NONCE_LENGTH),
    privateTargetsAllowed: request.allowPrivateTargets === true,
    showEndpoint: request.showEndpoint === true,
  }
  return Object.freeze({ ok: true, check: preparedCheck(execution, apiKey, estimate) })
}
