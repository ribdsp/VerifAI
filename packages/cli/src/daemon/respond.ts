/**
 * Every response the daemon sends, with the headers every response carries.
 *
 * The page is served with a CSP that admits nothing but its own origin, may
 * not be framed, and sends no referrer - so neither a script injected into a
 * report nor a page that frames this one gets anywhere. Error bodies are the
 * contract's envelope with a fixed message per code; nothing a client sent is
 * ever repeated back.
 */

import type { ServerResponse } from 'node:http'
import type { ApiErrorCode, ApiErrorResponse } from '@verifai/core'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cache-control': 'no-store',
})

export const JSON_TYPE = 'application/json; charset=utf-8'

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = Object.freeze({
  'invalid-request': 'The request is not one this daemon understands.',
  'not-found': 'Nothing here.',
  conflict: 'The check is not in a state that allows this.',
  busy: 'A check is already running. Wait for it to finish, or cancel it.',
  unauthorized: 'The session token is missing or wrong. Open the link `verifai web` printed.',
  forbidden: 'This request is not allowed from here.',
  'method-not-allowed': 'This path does not take that method.',
  'payload-too-large': 'The request body is too large.',
  'unsupported-media-type': 'Send the request body as application/json.',
  'rate-limited': 'Too many requests. Wait a moment and try again.',
  internal: 'The daemon failed to handle this request. Nothing was concluded.',
})

export type Headers = Readonly<Record<string, string>>

export function send(
  response: ServerResponse,
  status: number,
  body: string | Uint8Array,
  headers: Headers,
  head = false,
): void {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...headers,
    'content-length': String(bytes.byteLength),
  })
  response.end(head ? undefined : bytes)
}

export function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Headers = {},
): void {
  send(response, status, JSON.stringify(value), { 'content-type': JSON_TYPE, ...headers })
}

/** `message` overrides the code's fixed text; it must itself be fixed text, never input. */
export function sendError(
  response: ServerResponse,
  status: number,
  code: ApiErrorCode,
  options: { readonly message?: string; readonly headers?: Headers } = {},
): void {
  const message = options.message ?? ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal ?? ''
  const body: ApiErrorResponse = { error: { code, message } }
  sendJson(response, status, body, options.headers)
}
