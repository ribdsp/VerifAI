/**
 * The one path every probe request takes to the wire.
 *
 * A probe hands over a `ProbeRequest`; this adds the buyer's key, charges the
 * budget, sends it, records the evidence, and decides what the answer means
 * for the run: a response the probe reads, one retry after a transient
 * failure, a lost probe, or a stopped run. Probes never see any of it.
 */

import { adapterFor, authFor, buildRequest, type RequestSpec } from '../adapters/adapter.js'
import { readErrorBody } from '../adapters/error-body.js'
import type { Exchange, ProbeRequest, ProbeTarget } from '../probes/types.js'
import type {
  ConnectionReuse,
  Transport,
  TransportFailure,
  TransportRequest,
  TransportResponse,
  TransportResult,
} from '../transport/types.js'
import { BudgetExceeded, ProbeLost, RunAborted, RunStopped, TargetBlocked } from './errors.js'
import { requestDigest, sha256, toExchange } from './exchange.js'
import {
  DEFAULT_RETRY_WAIT_MS,
  isTransientFailure,
  isTransientStatus,
  retryWaitMs,
} from './retry.js'
import type { EvidenceEntry, EvidenceTiming, RunEvent } from './types.js'

export interface RunEnvironment {
  /** Monotonic milliseconds. */
  readonly clock: () => number
  /** The wall clock, for `retry-after` dates. */
  readonly wallClock: () => number
  /** Resolves after `ms`, or as soon as `signal` aborts. */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  /** Uniform in [0, 1). */
  readonly random: () => number
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

function defaultRandom(): number {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1))
  return value / 2 ** 32
}

export const DEFAULT_ENVIRONMENT: RunEnvironment = Object.freeze({
  clock: () => performance.now(),
  wallClock: () => Date.now(),
  sleep: defaultSleep,
  random: defaultRandom,
})

export interface SessionOptions {
  readonly target: ProbeTarget
  readonly transport: Transport
  /** Already normalised. */
  readonly apiKey: string | undefined
  readonly maxRequests: number
  readonly maxTokens: number
  readonly signal: AbortSignal
  readonly environment: RunEnvironment
  readonly emit: (event: RunEvent) => void
}

export interface SendOptions {
  readonly probeId: string
  /** The Group F repetition, which is never retried: a lost draw is re-run instead. */
  readonly draw?: number
}

export interface Session {
  readonly send: (request: ProbeRequest, options: SendOptions) => Promise<Exchange>
  /** Sleeps unless the run is cancelled first, announcing the wait. */
  readonly wait: (probeId: string, waitMs: number) => Promise<void>
  readonly throwIfAborted: () => void
  readonly evidence: () => readonly EvidenceEntry[]
  readonly requests: () => number
  readonly tokens: () => number
  /** Whether any request reached the endpoint. */
  readonly reached: () => boolean
}

type Attempt =
  | { readonly kind: 'done'; readonly exchange: Exchange }
  | { readonly kind: 'retry'; readonly waitMs: number }
  | { readonly kind: 'final'; readonly error: Error }

const MODEL_NOT_FOUND_CODE = 'model_not_found'

function timingOf(result: TransportResult): EvidenceTiming {
  if (!result.ok) {
    return Object.freeze({
      ttftMs: null,
      totalMs: result.timing.failedMs - result.timing.startedMs,
      tokensPerSecond: null,
    })
  }
  const first = result.chunks[0]
  return Object.freeze({
    ttftMs: first === undefined ? null : first.atMs - result.timing.startedMs,
    totalMs: result.timing.completedMs - result.timing.startedMs,
    tokensPerSecond: null,
  })
}

function failureAttempt(failure: TransportFailure): Attempt {
  switch (failure.kind) {
    case 'blocked-target':
      return { kind: 'final', error: new TargetBlocked() }
    case 'aborted':
      return { kind: 'final', error: new RunAborted() }
    default:
      return isTransientFailure(failure.kind)
        ? { kind: 'retry', waitMs: DEFAULT_RETRY_WAIT_MS }
        : { kind: 'final', error: new ProbeLost() }
  }
}

/** A 404 that says the claimed model is not there, in either vendor's words. */
function namesMissingModel(response: TransportResponse, model: string): boolean {
  const exchange = toExchange(response, false)
  const value = exchange.json.kind === 'json' ? exchange.json.value : undefined
  const error = readErrorBody(value)
  if (error === undefined) {
    return false
  }
  return error.code === MODEL_NOT_FOUND_CODE || error.message.includes(model)
}

/** The request fields the adapter takes as they are, when the probe set them. */
function optionalParts(
  request: ProbeRequest,
): Omit<RequestSpec, 'endpoint' | 'path' | 'signal' | 'apiKey' | 'auth'> {
  return {
    ...(request.method === undefined ? {} : { method: request.method }),
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(request.headers === undefined ? {} : { headers: request.headers }),
    ...(request.withoutHeaders === undefined ? {} : { withoutHeaders: request.withoutHeaders }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: request.maxResponseBytes }),
  }
}

/** An answer that ends the request, or the run, however the probe would read it. */
function refusalOf(
  response: TransportResponse,
  request: ProbeRequest,
  credential: 'buyer' | 'none',
  model: string,
): Error | undefined {
  if (credential === 'buyer' && response.status === 401) {
    return new RunStopped('invalid-key')
  }
  if (credential === 'buyer' && response.status === 403) {
    return new ProbeLost()
  }
  if (response.status === 404 && request.generates === true && namesMissingModel(response, model)) {
    return new RunStopped('model-not-found')
  }
  return undefined
}

export function createSession(options: SessionOptions): Session {
  const { target, transport, apiKey, signal, environment, emit } = options
  const secrets = apiKey === undefined ? [] : [apiKey]
  const startedMs = environment.clock()
  const evidence: EvidenceEntry[] = []
  let requests = 0
  let tokens = 0
  let reached = false

  const throwIfAborted = () => {
    if (signal.aborted) {
      throw new RunAborted()
    }
  }

  const credentialOf = (request: ProbeRequest): 'buyer' | 'none' => {
    const credential = request.credential ?? (apiKey === undefined ? 'none' : 'buyer')
    if (credential === 'buyer' && apiKey === undefined) {
      throw new TypeError('A probe asked for the buyer key in a run without one')
    }
    return credential
  }

  const build = (request: ProbeRequest, credential: 'buyer' | 'none'): TransportRequest => {
    const adapter = adapterFor(request.protocol ?? target.protocol)
    return buildRequest(adapter, {
      endpoint: target.endpoint,
      path: request.path,
      signal,
      auth: request.auth ?? authFor(adapter, target.auth),
      ...(credential === 'buyer' && apiKey !== undefined ? { apiKey } : {}),
      ...optionalParts(request),
    })
  }

  const record = async (
    wire: TransportRequest,
    result: TransportResult,
    sentAtMs: number,
    send: SendOptions,
    retry: boolean,
  ): Promise<void> => {
    const connection: ConnectionReuse = result.connection
    evidence.push(
      Object.freeze({
        probeId: send.probeId,
        requestDigest: await requestDigest(wire, secrets),
        responseDigest: result.ok ? await sha256(result.body) : null,
        status: result.ok ? result.status : null,
        ...(result.ok ? {} : { failure: result.kind }),
        sentAtMs,
        timing: timingOf(result),
        connection,
        ...(send.draw === undefined ? {} : { draw: send.draw }),
        ...(retry ? { retry: true } : {}),
      }),
    )
  }

  const responseAttempt = (
    response: TransportResponse,
    request: ProbeRequest,
    credential: 'buyer' | 'none',
    retried: boolean,
  ): Attempt => {
    const { status } = response
    if (request.provokes?.includes(status) === true) {
      return { kind: 'done', exchange: toExchange(response, retried) }
    }
    const refused = refusalOf(response, request, credential, target.requestedModel)
    if (refused !== undefined) {
      return { kind: 'final', error: refused }
    }
    if (isTransientStatus(status)) {
      const waitMs = retryWaitMs(response.headers, environment.wallClock())
      return waitMs === undefined
        ? { kind: 'final', error: new ProbeLost() }
        : { kind: 'retry', waitMs }
    }
    return { kind: 'done', exchange: toExchange(response, retried) }
  }

  const attempt = async (
    wire: TransportRequest,
    request: ProbeRequest,
    credential: 'buyer' | 'none',
    send: SendOptions,
    retry: boolean,
  ): Promise<Attempt> => {
    throwIfAborted()
    const cost = request.tokens ?? 0
    if (requests + 1 > options.maxRequests || tokens + cost > options.maxTokens) {
      throw new BudgetExceeded()
    }
    const sentAtMs = environment.clock() - startedMs
    requests += 1
    tokens += cost
    const result = await transport.send(wire)
    await record(wire, result, sentAtMs, send, retry)
    emit({
      kind: 'request',
      probeId: send.probeId,
      status: result.ok ? result.status : null,
      tokens: cost,
    })
    if (!result.ok) {
      reached ||= result.sent
      return failureAttempt(result)
    }
    reached = true
    return responseAttempt(result, request, credential, retry)
  }

  const wait = async (probeId: string, waitMs: number): Promise<void> => {
    throwIfAborted()
    emit({ kind: 'waiting', probeId, waitMs })
    await environment.sleep(waitMs, signal)
    throwIfAborted()
  }

  const send = async (request: ProbeRequest, options: SendOptions): Promise<Exchange> => {
    const credential = credentialOf(request)
    const wire = build(request, credential)
    const first = await attempt(wire, request, credential, options, false)
    if (first.kind === 'done') {
      return first.exchange
    }
    if (first.kind === 'final') {
      throw first.error
    }
    await wait(options.probeId, first.waitMs)
    if (options.draw !== undefined) {
      throw new ProbeLost()
    }
    const second = await attempt(wire, request, credential, options, true)
    if (second.kind === 'done') {
      return second.exchange
    }
    throw second.kind === 'final' ? second.error : new ProbeLost()
  }

  return Object.freeze({
    send,
    wait,
    throwIfAborted,
    evidence: () => Object.freeze([...evidence]),
    requests: () => requests,
    tokens: () => tokens,
    reached: () => reached,
  })
}
