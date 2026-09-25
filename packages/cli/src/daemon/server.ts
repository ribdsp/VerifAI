/**
 * `verifai web`'s daemon: the built page and its API, on loopback only.
 *
 * Every request passes the same gate, in an order where the cheap refusals
 * come first and a refused request costs a legitimate page nothing:
 *
 * 1. the Host must be this listener (DNS rebinding);
 * 2. a browser must say the request is from this page (cross-site requests);
 * 3. a process-wide rate limit;
 * 4. for the API, the session token, with failures limited on their own.
 *
 * The token is drawn per process and printed in the page's link, after the
 * `#`, so it reaches the page but never a server log, a `Referer` or history.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  type CheckEnvironment,
  type CheckRequest,
  prepareCheck,
  randomId,
  TOKEN_FRAGMENT_KEY,
  type Transport,
} from '@verifai/core'
import { type Assets, assetFor } from './assets.js'
import { isJsonBody, parseJson, readBody } from './body.js'
import { createCheckStore } from './checks.js'
import { isSameOrigin, LOOPBACK_HOST, localHost, tokenCheck } from './guard.js'
import { createWindowLimiter, type WindowLimiter } from './rate-limit.js'
import { type Headers, send, sendError, sendJson } from './respond.js'
import { type ApiCall, type Method, matchRoute, type Reply, type RouteContext } from './routes.js'

export const TOKEN_LENGTH = 48
const MINUTE_MS = 60_000
/** Well above a page polling twice a second, and far below a flood. */
export const REQUESTS_PER_MINUTE = 600
export const AUTH_FAILURES_PER_MINUTE = 30

const REQUEST_TIMEOUT_MS = 30_000
const HEADERS_TIMEOUT_MS = 10_000
const KEEP_ALIVE_TIMEOUT_MS = 5_000
const MAX_HEADER_BYTES = 16 * 1024

const STATIC_METHODS = 'GET, HEAD'

export interface DaemonOptions {
  /** 0 picks a free port. */
  readonly port: number
  readonly assets: Assets
  readonly allowPrivateTargets: boolean
  readonly createTransport: (allowPrivateTargets: boolean) => Transport
  readonly version: string
  readonly checkEnvironment?: Partial<CheckEnvironment>
  readonly now?: () => number
  /** Given the redacted detail of a failure inside VerifAI, never the buyer's input. */
  readonly onFailure?: (detail: string) => void
  /** For tests: fixed limits instead of the defaults. */
  readonly limits?: { readonly requestsPerMinute: number; readonly authFailuresPerMinute: number }
}

export interface Daemon {
  /** The page's link, token included. Print it; never log it anywhere else. */
  readonly url: string
  readonly origin: string
  readonly port: number
  readonly token: string
  readonly close: () => Promise<void>
}

export class DaemonStartError extends Error {
  override readonly name = 'DaemonStartError'
}

interface Gate {
  readonly port: number
  readonly traffic: WindowLimiter
  readonly authFailures: WindowLimiter
  readonly isAuthorised: (request: IncomingMessage) => boolean
  readonly routes: RouteContext
  readonly assets: Assets
}

function refuseRate(response: ServerResponse, retryAfterSeconds: number): void {
  sendError(response, 429, 'rate-limited', {
    headers: { 'retry-after': String(retryAfterSeconds) },
  })
}

/** Top-level navigation to the page, which a link opened from elsewhere is. */
function isNavigation(request: IncomingMessage): boolean {
  return (
    request.headers['sec-fetch-mode'] === 'navigate' &&
    request.headers['sec-fetch-dest'] === 'document'
  )
}

function reply(response: ServerResponse, result: Reply): void {
  if ('json' in result) {
    sendJson(response, result.status, result.json)
  } else if ('text' in result) {
    send(response, result.status, result.text, { 'content-type': result.type })
  } else {
    sendError(response, result.status, result.error, {
      ...(result.message === undefined ? {} : { message: result.message }),
      ...(result.headers === undefined ? {} : { headers: result.headers }),
    })
  }
}

type BodyRead = { readonly ok: true; readonly body: unknown } | { readonly ok: false }

async function jsonBody(request: IncomingMessage, response: ServerResponse): Promise<BodyRead> {
  if (!isJsonBody(request)) {
    sendError(response, 415, 'unsupported-media-type')
    return { ok: false }
  }
  const read = await readBody(request)
  if (!read.ok) {
    const close: Headers = { connection: 'close' }
    if (read.problem === 'too-large') {
      sendError(response, 413, 'payload-too-large', { headers: close })
    } else {
      sendError(response, 400, 'invalid-request', {
        message: 'The body is not readable UTF-8.',
        headers: close,
      })
    }
    return { ok: false }
  }
  const parsed = parseJson(read.text)
  if (!parsed.ok) {
    sendError(response, 400, 'invalid-request', { message: 'The body is not valid JSON.' })
    return { ok: false }
  }
  return { ok: true, body: parsed.value }
}

async function serveApi(
  gate: Gate,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const exhausted = gate.authFailures.exhausted()
  if (!exhausted.ok) {
    refuseRate(response, exhausted.retryAfterSeconds)
    return
  }
  if (!gate.isAuthorised(request)) {
    gate.authFailures.take()
    sendError(response, 401, 'unauthorized', { headers: { 'www-authenticate': 'Bearer' } })
    return
  }
  const route = matchRoute(url.pathname, gate.routes.version)
  if (route === undefined) {
    sendError(response, 404, 'not-found')
    return
  }
  const handler = route.handlers[request.method as Method]
  if (handler === undefined) {
    sendError(response, 405, 'method-not-allowed', {
      headers: { allow: Object.keys(route.handlers).join(', ') },
    })
    return
  }
  let body: unknown
  if (route.takesBody) {
    const read = await jsonBody(request, response)
    if (!read.ok) {
      return
    }
    body = read.body
  }
  const call: ApiCall = { checkId: route.checkId, query: url.searchParams, body }
  reply(response, await handler(call, gate.routes))
}

function serveStatic(gate: Gate, request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendError(response, 405, 'method-not-allowed', { headers: { allow: STATIC_METHODS } })
    return
  }
  const asset = assetFor(gate.assets, url.pathname)
  if (asset === undefined) {
    sendError(response, 404, 'not-found')
    return
  }
  send(response, 200, asset.body, { 'content-type': asset.type }, request.method === 'HEAD')
}

async function handle(gate: Gate, request: IncomingMessage, response: ServerResponse) {
  const target = request.url ?? ''
  // Origin-form only: an absolute or `//host` target would name some other server.
  if (!target.startsWith('/') || target.startsWith('//')) {
    sendError(response, 400, 'invalid-request')
    return
  }
  const host = localHost(request.headers, gate.port)
  if (host === undefined) {
    sendError(response, 403, 'forbidden')
    return
  }
  const url = new URL(target, `http://${host}`)
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/')
  if (!(isSameOrigin(request.headers, host) || (!isApi && isNavigation(request)))) {
    sendError(response, 403, 'forbidden')
    return
  }
  const admission = gate.traffic.take()
  if (!admission.ok) {
    refuseRate(response, admission.retryAfterSeconds)
    return
  }
  if (isApi) {
    await serveApi(gate, request, response, url)
  } else {
    serveStatic(gate, request, response, url)
  }
}

function listen(server: Server, port: number, onError: (error: Error) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (error: NodeJS.ErrnoException) => {
      reject(
        new DaemonStartError(
          error.code === 'EADDRINUSE'
            ? `Port ${port} is already in use. Pick another with --port, or 0 for any free port.`
            : 'Could not listen on the loopback address.',
        ),
      )
    }
    server.once('error', failed)
    server.listen({ host: LOOPBACK_HOST, port, exclusive: true }, () => {
      server.off('error', failed)
      // Past listening the server can still fail - an accept that runs out of
      // file descriptors, say. Reported, never thrown: an unhandled 'error'
      // would take the daemon, and every check it holds, down with it.
      server.on('error', onError)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function prepareWith(options: DaemonOptions, signal: AbortSignal) {
  return (request: CheckRequest) =>
    prepareCheck(request, {
      transport: options.createTransport(request.allowPrivateTargets === true),
      dilutionSupported: true,
      toolVersion: options.version,
      signal,
      ...options.checkEnvironment,
    })
}

/** @throws DaemonStartError when the port cannot be listened on. */
export async function startDaemon(options: DaemonOptions): Promise<Daemon> {
  const token = randomId(TOKEN_LENGTH)
  const closing = new AbortController()
  const onFailure = options.onFailure ?? (() => undefined)
  const store = createCheckStore({
    onFailure,
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  const limits = options.limits ?? {
    requestsPerMinute: REQUESTS_PER_MINUTE,
    authFailuresPerMinute: AUTH_FAILURES_PER_MINUTE,
  }
  const hasToken = tokenCheck(token)
  const server = createServer({
    requestTimeout: REQUEST_TIMEOUT_MS,
    headersTimeout: HEADERS_TIMEOUT_MS,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    maxHeaderSize: MAX_HEADER_BYTES,
  })
  const port = await listen(server, options.port, (error) => {
    onFailure(`server failed: ${error.name}`)
  })
  const gate: Gate = {
    port,
    traffic: createWindowLimiter({ limit: limits.requestsPerMinute, windowMs: MINUTE_MS }),
    authFailures: createWindowLimiter({ limit: limits.authFailuresPerMinute, windowMs: MINUTE_MS }),
    isAuthorised: (request) => hasToken(request.headers),
    routes: {
      store,
      version: options.version,
      allowPrivateTargets: options.allowPrivateTargets,
      prepare: prepareWith(options, closing.signal),
    },
    assets: options.assets,
  }
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    // A socket that fails under a reply is the browser's loss, not the daemon's.
    response.on('error', (error: Error) => {
      onFailure(`response failed: ${error.name}`)
    })
    handle(gate, request, response).catch((error: unknown) => {
      onFailure(`request failed: ${error instanceof Error ? error.name : 'non-error thrown'}`)
      if (response.headersSent) {
        response.destroy()
      } else {
        sendError(response, 500, 'internal')
      }
    })
  })
  const origin = `http://${LOOPBACK_HOST}:${port}`
  return Object.freeze({
    url: `${origin}/#${TOKEN_FRAGMENT_KEY}=${token}`,
    origin,
    port,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        closing.abort()
        store.close()
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  })
}
