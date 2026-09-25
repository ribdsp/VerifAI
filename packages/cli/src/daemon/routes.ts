/**
 * The daemon's API, as pure-ish handlers: a matched route, its parameters and
 * body in, a reply out. The server does the HTTP around them - the locks in
 * `guard.ts`, reading the body, writing the reply - so these are about the
 * contract in `@verifai/core` and nothing else.
 */

import {
  API_PATHS,
  type ApiErrorCode,
  type CheckRequest,
  type Preparation,
  parseCheckRequest,
  REPORT_FORMATS,
  renderJson,
  renderMarkdown,
} from '@verifai/core'
import type { CheckStore } from './checks.js'
import { optionsResponse } from './options.js'
import { type Headers, JSON_TYPE } from './respond.js'

export type Method = 'GET' | 'POST' | 'DELETE'

export type Reply =
  | { readonly status: number; readonly json: unknown }
  | {
      readonly status: number
      readonly text: string
      readonly type: string
    }
  | {
      readonly status: number
      readonly error: ApiErrorCode
      /** Fixed text, or problems that name fields; never a value the client sent. */
      readonly message?: string
      readonly headers?: Headers
    }

export interface RouteContext {
  readonly store: CheckStore
  readonly version: string
  /** Whether `verifai web` itself was started with --allow-private-targets. */
  readonly allowPrivateTargets: boolean
  readonly prepare: (request: CheckRequest) => Promise<Preparation>
}

export interface ApiCall {
  /** The check a `/api/checks/:id` path names. */
  readonly checkId: string
  readonly query: URLSearchParams
  readonly body: unknown
}

type Handler = (call: ApiCall, context: RouteContext) => Reply | Promise<Reply>

export interface Route {
  readonly handlers: Readonly<Partial<Record<Method, Handler>>>
  /** Whether the POST handler reads a JSON body. */
  readonly takesBody: boolean
  readonly checkId: string
}

/** Ids this daemon hands out, and a bound on what is looked up. */
const CHECK_ID = /^[a-z0-9]{1,64}$/
const EVENT_INDEX = /^\d{1,9}$/

export const PRIVATE_TARGETS_REFUSED =
  'Private addresses can be checked only when `verifai web` was started with --allow-private-targets.'

/** Refusals that are the request's fault; the endpoint's own go out as 502. */
const REFUSAL_STATUS: Readonly<Partial<Record<ApiErrorCode, number>>> = Object.freeze({
  'invalid-request': 400,
  'invalid-endpoint': 400,
  'invalid-api-key': 400,
  'invalid-model': 400,
  'blocked-target': 403,
  internal: 500,
})

function problem(message: string): Reply {
  return { status: 400, error: 'invalid-request', message }
}

async function createCheck(call: ApiCall, context: RouteContext): Promise<Reply> {
  const parsed = parseCheckRequest(call.body)
  if (!parsed.ok) {
    return problem(parsed.problems.join('; '))
  }
  const request = parsed.value
  if (request.allowPrivateTargets === true && !context.allowPrivateTargets) {
    return { status: 403, error: 'forbidden', message: PRIVATE_TARGETS_REFUSED }
  }
  const result = await context.store.create(() => context.prepare(request))
  switch (result.kind) {
    case 'created':
      return { status: 201, json: result.response }
    case 'busy':
      return { status: 409, error: 'busy' }
    default: {
      const { code, message } = result.error
      return { status: REFUSAL_STATUS[code] ?? 502, error: code, message }
    }
  }
}

function startCheck(call: ApiCall, context: RouteContext): Reply {
  switch (context.store.start(call.checkId)) {
    case 'ok':
      return { status: 202, json: { checkId: call.checkId, state: 'running' } }
    case 'not-found':
      return { status: 404, error: 'not-found' }
    default:
      return { status: 409, error: 'conflict' }
  }
}

function cancelCheck(call: ApiCall, context: RouteContext): Reply {
  const state = context.store.cancel(call.checkId)
  return state === undefined
    ? { status: 404, error: 'not-found' }
    : { status: 200, json: { checkId: call.checkId, state } }
}

function checkStatus(call: ApiCall, context: RouteContext): Reply {
  const since = call.query.get('since') ?? '0'
  if (!EVENT_INDEX.test(since)) {
    return problem('since: expected a whole number of events')
  }
  const status = context.store.status(call.checkId, Number(since))
  return status === undefined ? { status: 404, error: 'not-found' } : { status: 200, json: status }
}

function checkReport(call: ApiCall, context: RouteContext): Reply {
  const format = call.query.get('format') ?? 'json'
  if (!REPORT_FORMATS.has(format)) {
    return problem(`format: expected ${REPORT_FORMATS.values.join(' or ')}`)
  }
  const lookup = context.store.report(call.checkId)
  switch (lookup.kind) {
    case 'not-found':
      return { status: 404, error: 'not-found' }
    case 'conflict':
      return { status: 409, error: 'conflict', message: 'The check has no report.' }
    default:
      return format === 'markdown'
        ? { status: 200, text: renderMarkdown(lookup.report), type: 'text/markdown; charset=utf-8' }
        : { status: 200, text: renderJson(lookup.report), type: JSON_TYPE }
  }
}

function route(handlers: Route['handlers'], checkId = '', takesBody = false): Route {
  return Object.freeze({ handlers: Object.freeze(handlers), takesBody, checkId })
}

// biome-ignore-start lint/style/useNamingConvention: HTTP's method names.
function checkRoute(rest: readonly string[]): Route | undefined {
  const [checkId, action, ...extra] = rest
  if (checkId === undefined || !CHECK_ID.test(checkId) || extra.length > 0) {
    return undefined
  }
  switch (action) {
    case undefined:
      return route({ GET: checkStatus, DELETE: cancelCheck }, checkId)
    case 'start':
      return route({ POST: startCheck }, checkId)
    case 'report':
      return route({ GET: checkReport }, checkId)
    default:
      return undefined
  }
}

/** The route a path names, or `undefined` for one this API does not have. */
export function matchRoute(pathname: string, version: string): Route | undefined {
  switch (pathname) {
    case API_PATHS.health:
      return route({ GET: () => ({ status: 200, json: { ok: true, version } }) })
    case API_PATHS.options:
      return route({ GET: () => ({ status: 200, json: optionsResponse(version) }) })
    case API_PATHS.checks:
      return route({ POST: createCheck }, '', true)
    default:
      return pathname.startsWith(`${API_PATHS.checks}/`)
        ? checkRoute(pathname.slice(API_PATHS.checks.length + 1).split('/'))
        : undefined
  }
}
// biome-ignore-end lint/style/useNamingConvention: HTTP's method names.
