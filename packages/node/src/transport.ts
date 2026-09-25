/**
 * The Node transport: `node:http` and `node:https`, a connection of its own for
 * every request, pinned to the addresses the guard approved.
 *
 * A fresh connection per request is deliberate. It is what lets Group F count a
 * repetition as an independent draw, and it means no socket outlives the check
 * that admitted it.
 */

import http from 'node:http'
import https from 'node:https'
import {
  assertSendableHeaders,
  type ConnectionReuse,
  checkAddresses,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  HTTP_METHODS,
  type HttpMethod,
  headerValue,
  pairsFromRawHeaders,
  parseTargetUrl,
  type RefusedScope,
  type TargetPolicy,
  type TargetUrl,
  type Transport,
  type TransportFailureKind,
  type TransportRequest,
  type TransportResult,
  transportFailure,
} from '@verifai/core'
import { bodyCoding, readBody } from './body.js'
import { pinnedLookup, type Resolver, systemResolver, UNPINNED_LOOKUP } from './resolver.js'

export interface NodeTransportOptions {
  /** Per run, from the command line. Never from a config file. */
  readonly allowPrivateTargets: boolean
  readonly resolver?: Resolver
  /** Milliseconds on a monotonic clock. */
  readonly clock?: () => number
  /**
   * Sent as `User-Agent` on every request that does not carry one of its own.
   * Some platforms, Snowflake Cortex among them, refuse a request without one.
   */
  readonly userAgent?: string
}

/** The longest delay `setTimeout` honours; anything longer fires immediately. */
const MAX_TIMER_MS = 2_147_483_647

/** Methods that frame an absent body as `Content-Length: 0` rather than leaving it out. */
const BODY_METHODS: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH'])

interface Context {
  readonly policy: TargetPolicy
  readonly resolver: Resolver
  readonly clock: () => number
  readonly userAgent: string | undefined
}

interface Plan {
  readonly request: TransportRequest
  readonly target: TargetUrl | { readonly blockedScope: RefusedScope }
  readonly timeoutMs: number
  readonly maxResponseBytes: number
}

type StopReason = 'timeout' | 'aborted'

/** The deadline and the caller's signal, folded into one signal for this request. */
interface Stop {
  readonly signal: AbortSignal
  readonly reason: () => StopReason | undefined
  readonly dispose: () => void
}

/** @throws TypeError for a `userAgent` that could not be sent, before anything is. */
export function createNodeTransport(options: NodeTransportOptions): Transport {
  const { userAgent } = options
  if (userAgent !== undefined) {
    if (userAgent === '') {
      throw new TypeError('The User-Agent must not be empty')
    }
    assertSendableHeaders([['User-Agent', userAgent]])
  }
  const context: Context = Object.freeze({
    policy: Object.freeze({ allowPrivateTargets: options.allowPrivateTargets }),
    resolver: options.resolver ?? systemResolver,
    clock: options.clock ?? (() => performance.now()),
    userAgent,
  })
  return Object.freeze({ send: (request: TransportRequest) => send(request, context) })
}

/** @throws TypeError for a request no endpoint could be blamed for. */
function prepare(request: TransportRequest, policy: TargetPolicy): Plan {
  if (!HTTP_METHODS.has(request.method)) {
    throw new TypeError('The request method is not one VerifAI sends')
  }
  assertSendableHeaders(request.headers)
  if (request.body !== undefined && !(request.body instanceof Uint8Array)) {
    throw new TypeError('The request body must be a Uint8Array')
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMER_MS)) {
    throw new TypeError(`timeoutMs must be above 0 and at most ${MAX_TIMER_MS}`)
  }
  const maxResponseBytes = request.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  if (!(Number.isSafeInteger(maxResponseBytes) && maxResponseBytes >= 0)) {
    throw new TypeError('maxResponseBytes must be a whole number of bytes')
  }

  // The problem name only, never the URL: it may carry a credential.
  const parsed = parseTargetUrl(request.url, policy)
  if (!parsed.ok && parsed.problem !== 'blocked-address') {
    throw new TypeError(`The request URL was refused: ${parsed.problem}`)
  }
  const target = parsed.ok ? parsed.target : { blockedScope: parsed.scope }
  return { request, target, timeoutMs, maxResponseBytes }
}

function createStop(timeoutMs: number, external: AbortSignal | undefined): Stop {
  const controller = new AbortController()
  let reason: StopReason | undefined
  const stop = (why: StopReason) => {
    if (reason === undefined) {
      reason = why
      controller.abort()
    }
  }
  const onAbort = () => stop('aborted')

  if (external?.aborted) {
    stop('aborted')
  }
  external?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => stop('timeout'), timeoutMs)

  return {
    signal: controller.signal,
    reason: () => reason,
    dispose: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
  }
}

type Resolution =
  | { readonly ok: true; readonly addresses: readonly string[] }
  | { readonly ok: false; readonly kind: 'dns-failure' | StopReason }

/**
 * The resolver's own error is dropped on purpose. "No such host" against
 * "server failure" against "timed out" is what a caller would use to map a
 * private DNS zone through VerifAI.
 */
async function resolveTarget(
  target: TargetUrl,
  resolver: Resolver,
  stop: Stop,
): Promise<Resolution> {
  if (target.addressLiteral !== undefined) {
    return { ok: true, addresses: [target.hostname] }
  }

  const stopped = new Promise<'stopped'>((resolve) => {
    stop.signal.addEventListener('abort', () => resolve('stopped'), { once: true })
  })
  try {
    const answer = await Promise.race([
      Promise.resolve().then(() => resolver(target.hostname)),
      stopped,
    ])
    if (answer === 'stopped') {
      return { ok: false, kind: stop.reason() ?? 'aborted' }
    }
    if (!Array.isArray(answer) || answer.length === 0 || !answer.every(isString)) {
      return { ok: false, kind: 'dns-failure' }
    }
    return { ok: true, addresses: Object.freeze([...answer]) }
  } catch {
    return { ok: false, kind: 'dns-failure' }
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

async function send(request: TransportRequest, context: Context): Promise<TransportResult> {
  const plan = prepare(request, context.policy)
  const startedMs = context.clock()
  const refuse = (kind: TransportFailureKind, blockedScope?: RefusedScope) =>
    transportFailure(kind, {
      sent: false,
      connection: 'unobserved',
      startedMs,
      failedMs: context.clock(),
      ...(blockedScope === undefined ? {} : { blockedScope }),
    })

  if ('blockedScope' in plan.target) {
    return refuse('blocked-target', plan.target.blockedScope)
  }

  const target = plan.target
  const stop = createStop(plan.timeoutMs, request.signal)
  try {
    const early = stop.reason()
    if (early !== undefined) {
      return refuse(early)
    }

    const resolution = await resolveTarget(target, context.resolver, stop)
    if (!resolution.ok) {
      return refuse(resolution.kind)
    }
    const verdict = checkAddresses(resolution.addresses, context.policy)
    if (!verdict.admitted) {
      return refuse('blocked-target', verdict.scope)
    }

    return await exchange({
      plan,
      target,
      addresses: resolution.addresses,
      stop,
      context,
      startedMs,
    })
  } finally {
    stop.dispose()
  }
}

/**
 * Flat `[name, value, ...]`, which is the one header form Node sends verbatim:
 * no `Host` of its own, no reordering, no merging of repeats.
 */
function wireHeaders(
  request: TransportRequest,
  target: TargetUrl,
  userAgent: string | undefined,
): string[] {
  const flat = ['Host', target.host, ...request.headers.flat()]
  if (userAgent !== undefined && headerValue(request.headers, 'user-agent') === undefined) {
    flat.push('User-Agent', userAgent)
  }
  const length = request.body?.length ?? (BODY_METHODS.has(request.method) ? 0 : undefined)
  if (length !== undefined) {
    flat.push('Content-Length', String(length))
  }
  flat.push('Connection', 'close')
  return flat
}

interface Exchange {
  readonly plan: Plan
  readonly target: TargetUrl
  readonly addresses: readonly string[]
  readonly stop: Stop
  readonly context: Context
  readonly startedMs: number
}

/**
 * How far the exchange got, which is what a socket error means: refused while
 * connecting, a bad certificate while handshaking, garbage once the request
 * has gone out.
 */
type Phase = 'connecting' | 'handshaking' | 'exchanging'

const ERROR_KINDS: Readonly<Record<Phase, TransportFailureKind>> = Object.freeze({
  connecting: 'connection-failed',
  handshaking: 'tls-failure',
  exchanging: 'unreadable-response',
})

function exchange({
  plan,
  target,
  addresses,
  stop,
  context,
  startedMs,
}: Exchange): Promise<TransportResult> {
  const { clock } = context
  const secure = target.protocol === 'https:'

  return new Promise((resolve) => {
    let phase: Phase = 'connecting'
    let connection: ConnectionReuse = 'unobserved'
    let responded = false
    let settled = false

    const req = (secure ? https : http).request({
      method: plan.request.method,
      hostname: target.hostname,
      port: target.port,
      path: target.path,
      headers: wireHeaders(plan.request, target, context.userAgent),
      setHost: false,
      agent: false,
      lookup: pinnedLookup(target.hostname, addresses),
      ...(secure && target.addressLiteral === undefined ? { servername: target.hostname } : {}),
    })

    const settle = (result: TransportResult) => {
      if (!settled) {
        settled = true
        stop.signal.removeEventListener('abort', onStop)
        req.destroy()
        resolve(result)
      }
    }
    const fail = (kind: TransportFailureKind, blockedScope?: RefusedScope) =>
      settle(
        transportFailure(kind, {
          sent: phase === 'exchanging',
          connection,
          startedMs,
          failedMs: clock(),
          ...(blockedScope === undefined ? {} : { blockedScope }),
        }),
      )
    const onStop = () => fail(stop.reason() ?? 'aborted')

    const connected = () => {
      connection = 'fresh'
      phase = secure ? 'handshaking' : 'exchanging'
    }
    req.on('socket', (socket) => {
      if (req.reusedSocket) {
        connection = 'reused'
        phase = 'exchanging'
        return
      }
      socket.once('connect', connected)
      socket.once('secureConnect', () => {
        phase = 'exchanging'
      })
    })

    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === UNPINNED_LOOKUP) {
        fail('blocked-target', 'forbidden')
        return
      }
      fail(ERROR_KINDS[phase])
    })
    // Every path that ends without a response and without an error - an
    // upgrade nobody asked for, say - still has to settle.
    req.on('close', () => {
      if (!responded) {
        fail(ERROR_KINDS[phase])
      }
    })

    req.on('response', (res) => {
      responded = true
      phase = 'exchanging'
      const headersMs = clock()
      const headers = pairsFromRawHeaders(res.rawHeaders)
      const coding = bodyCoding(headers)
      if (coding === 'unsupported') {
        res.destroy()
        fail('unreadable-response')
        return
      }

      void readBody(res, coding, plan.maxResponseBytes, clock).then((outcome) => {
        if (!outcome.ok) {
          fail(outcome.kind)
          return
        }
        settle(
          Object.freeze({
            ok: true,
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            httpVersion: res.httpVersion,
            headers,
            body: outcome.body,
            chunks: outcome.chunks,
            connection,
            timing: Object.freeze({ startedMs, headersMs, completedMs: outcome.completedMs }),
          }),
        )
      })
    })

    stop.signal.addEventListener('abort', onStop, { once: true })
    if (stop.signal.aborted) {
      onStop()
      return
    }
    req.end(plan.request.body)
  })
}
