/**
 * The page's only way to reach the daemon.
 *
 * Every call is same-origin, carries the session token as a bearer header and
 * nothing else that identifies the browser, and turns every way it can fail -
 * the network, an error envelope, a body this page cannot read - into one
 * `ApiClientError` with a fixed message. The API key travels in exactly one
 * request body, `createCheck`, and is never part of a URL or an error.
 */

import {
  API_ERROR_CODES,
  API_PATHS,
  type ApiError,
  type ApiErrorCode,
  CHECK_STATES,
  type CheckEvent,
  type CheckRequest,
  type CheckStatusResponse,
  type CreateCheckResponse,
  type HealthResponse,
  type OptionsResponse,
  type Report,
  type ReportFormat,
} from '@verifai/core'
import {
  hasCounts,
  isCount,
  isEstimate,
  isOptions,
  isRecord,
  isRunEvent,
  isString,
  type Json,
  looksLikeReport,
} from './guards'
import { sessionToken } from './session'

export type ClientErrorCode =
  | ApiErrorCode
  | 'network'
  | 'malformed-response'
  | 'http'
  | 'aborted'
  | 'no-session'

const CLIENT_MESSAGES = Object.freeze({
  network: 'Could not reach the VerifAI daemon. Is `verifai web` still running?',
  'malformed-response': 'The daemon sent a response this page could not read.',
  aborted: 'The request was cancelled.',
  'no-session':
    'This page has no session token. Open the link `verifai web` printed in your terminal.',
})

/** A daemon message is fixed text, but it is still text from outside this page. */
const MAX_SERVER_MESSAGE = 600

export class ApiClientError extends Error {
  readonly code: ClientErrorCode
  /** The HTTP status, or `null` when there was no response. */
  readonly status: number | null

  constructor(code: ClientErrorCode, message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
  }
}

function clientError(code: keyof typeof CLIENT_MESSAGES, status: number | null = null) {
  return new ApiClientError(code, CLIENT_MESSAGES[code], status)
}

function apiErrorOf(value: unknown): ApiError | undefined {
  if (isRecord(value) && API_ERROR_CODES.has(value.code) && isString(value.message)) {
    return { code: value.code, message: value.message.slice(0, MAX_SERVER_MESSAGE) }
  }
  return undefined
}

/** The envelope's error, or a fixed one naming only the status. */
export function errorFromBody(body: unknown, status: number): ApiClientError {
  const error = apiErrorOf(isRecord(body) ? body.error : undefined)
  if (error === undefined) {
    return new ApiClientError('http', `The daemon answered with HTTP ${status}.`, status)
  }
  return new ApiClientError(error.code, error.message, status)
}

export function parseCreate(body: unknown): CreateCheckResponse {
  if (
    isRecord(body) &&
    isString(body.checkId) &&
    body.checkId !== '' &&
    isEstimate(body.estimate)
  ) {
    return { checkId: body.checkId, estimate: body.estimate }
  }
  throw clientError('malformed-response')
}

/** A status body whose events are sequenced but not yet read. */
interface StatusBody extends Omit<CheckStatusResponse, 'events' | 'error'> {
  readonly events: readonly Json[]
  readonly error?: unknown
}

function isSequenced(value: unknown): value is Json {
  return isRecord(value) && isCount(value.seq)
}

function isStatusBody(body: unknown): body is StatusBody {
  return (
    isRecord(body) &&
    isString(body.checkId) &&
    CHECK_STATES.has(body.state) &&
    isCount(body.nextEvent) &&
    hasCounts(body.progress, ['done', 'total', 'requests', 'tokens']) &&
    Array.isArray(body.events) &&
    body.events.every(isSequenced) &&
    (body.report === undefined || looksLikeReport(body.report))
  )
}

/** An event of a kind this page does not know is left out rather than guessed at. */
function knownEvents(events: readonly Json[]): CheckEvent[] {
  return events.flatMap(({ seq, event }) =>
    isCount(seq) && isRunEvent(event) ? [{ seq, event }] : [],
  )
}

export function parseStatus(body: unknown): CheckStatusResponse {
  if (!isStatusBody(body)) {
    throw clientError('malformed-response')
  }
  const error = apiErrorOf(body.error)
  if (body.error !== undefined && error === undefined) {
    throw clientError('malformed-response')
  }
  return {
    checkId: body.checkId,
    state: body.state,
    progress: body.progress,
    events: knownEvents(body.events),
    nextEvent: body.nextEvent,
    ...(body.report === undefined ? {} : { report: body.report }),
    ...(error === undefined ? {} : { error }),
  }
}

export function parseReport(body: unknown): Report {
  if (looksLikeReport(body)) {
    return body
  }
  throw clientError('malformed-response')
}

function parseHealth(body: unknown): HealthResponse {
  if (isRecord(body) && body.ok === true && isString(body.version)) {
    return { ok: true, version: body.version }
  }
  throw clientError('malformed-response')
}

function parseOptions(body: unknown): OptionsResponse {
  if (isOptions(body)) {
    return body
  }
  throw clientError('malformed-response')
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ApiClientOptions {
  readonly fetch: FetchLike
  /** Read on every call, so the token lives in one place only. */
  readonly token?: () => string | undefined
}

export interface ApiClient {
  readonly health: (signal?: AbortSignal) => Promise<HealthResponse>
  readonly options: (signal?: AbortSignal) => Promise<OptionsResponse>
  readonly createCheck: (
    request: CheckRequest,
    signal?: AbortSignal,
  ) => Promise<CreateCheckResponse>
  readonly startCheck: (checkId: string, signal?: AbortSignal) => Promise<void>
  readonly cancelCheck: (checkId: string, signal?: AbortSignal) => Promise<void>
  readonly status: (
    checkId: string,
    since: number,
    signal?: AbortSignal,
  ) => Promise<CheckStatusResponse>
  readonly report: (checkId: string, signal?: AbortSignal) => Promise<Report>
  readonly download: (checkId: string, format: ReportFormat, signal?: AbortSignal) => Promise<Blob>
}

type Method = 'GET' | 'POST' | 'DELETE'

function checkPath(checkId: string, suffix = ''): string {
  return `${API_PATHS.checks}/${encodeURIComponent(checkId)}${suffix}`
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const send = options.fetch
  const tokenOf = options.token ?? sessionToken

  async function call(
    method: Method,
    path: string,
    signal: AbortSignal | undefined,
    body?: CheckRequest,
  ): Promise<Response> {
    const token = tokenOf()
    if (token === undefined) {
      throw clientError('no-session')
    }
    const headers = {
      authorization: `Bearer ${token}`,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
    }
    let response: Response
    try {
      response = await send(path, {
        method,
        headers,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      throw clientError(signal?.aborted === true ? 'aborted' : 'network')
    }
    if (!response.ok) {
      // An unreadable error body still fails the call, as a plain HTTP error.
      const envelope = await readJson(response, signal).catch(() => undefined)
      throw errorFromBody(envelope, response.status)
    }
    return response
  }

  async function readJson(response: Response, signal: AbortSignal | undefined): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      throw clientError(
        signal?.aborted === true ? 'aborted' : 'malformed-response',
        response.status,
      )
    }
  }

  async function getJson<T>(
    path: string,
    parse: (body: unknown) => T,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const response = await call('GET', path, signal)
    return parse(await readJson(response, signal))
  }

  const client: ApiClient = {
    health: (signal) => getJson(API_PATHS.health, parseHealth, signal),
    options: (signal) => getJson(API_PATHS.options, parseOptions, signal),
    createCheck: async (request, signal) => {
      const response = await call('POST', API_PATHS.checks, signal, request)
      return parseCreate(await readJson(response, signal))
    },
    startCheck: async (checkId, signal) => {
      await call('POST', checkPath(checkId, '/start'), signal)
    },
    cancelCheck: async (checkId, signal) => {
      await call('DELETE', checkPath(checkId), signal)
    },
    status: (checkId, since, signal) =>
      getJson(checkPath(checkId, `?since=${Math.max(0, Math.trunc(since))}`), parseStatus, signal),
    report: (checkId, signal) =>
      getJson(checkPath(checkId, '/report?format=json'), parseReport, signal),
    download: async (checkId, format, signal) => {
      const response = await call('GET', checkPath(checkId, `/report?format=${format}`), signal)
      try {
        return await response.blob()
      } catch {
        throw clientError(signal?.aborted === true ? 'aborted' : 'network', response.status)
      }
    },
  }
  return Object.freeze(client)
}

/** The message to show for anything a call threw. */
export function messageOf(error: unknown): string {
  return error instanceof ApiClientError ? error.message : 'Something went wrong in this page.'
}
