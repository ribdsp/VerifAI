/**
 * Who may talk to the daemon.
 *
 * Three independent locks, each enough on its own against a different attacker:
 *
 * - The Host header must name this loopback listener, which stops DNS
 *   rebinding - a hostile page that points its own name at 127.0.0.1 still
 *   sends its own name as the Host.
 * - A browser's Origin and Sec-Fetch-Site must say same-origin, which stops a
 *   cross-site request before the token is even looked at.
 * - The API needs the session token as a bearer header. It exists only in the
 *   link this process printed and in the page's memory; a cross-site request
 *   cannot set an Authorization header without a CORS preflight this daemon
 *   never grants.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'

export const LOOPBACK_HOST = '127.0.0.1'

/** The names the page may be opened under. */
const LOCAL_NAMES: readonly string[] = Object.freeze([LOOPBACK_HOST, 'localhost'])

/** Sec-Fetch-Site values a request from this page, or a typed URL, carries. */
const SAME_SITE_FETCHES: ReadonlySet<string> = new Set(['same-origin', 'none'])

const BEARER = /^Bearer ([A-Za-z0-9]{1,256})$/

/** A browser leaves HTTP's default port out of the Host it sends. */
const DEFAULT_HTTP_PORT = 80

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value
}

/** The Host this listener answers to, or `undefined` for any other. */
export function localHost(headers: IncomingHttpHeaders, port: number): string | undefined {
  const host = single(headers.host)?.toLowerCase()
  const names = (name: string) =>
    host === `${name}:${port}` || (port === DEFAULT_HTTP_PORT && host === name)
  return host !== undefined && LOCAL_NAMES.some(names) ? host : undefined
}

/** Whether a browser, if this is one, says the request comes from the daemon's own page. */
export function isSameOrigin(headers: IncomingHttpHeaders, host: string): boolean {
  const origin = headers.origin
  if (origin !== undefined && single(origin)?.toLowerCase() !== `http://${host}`) {
    return false
  }
  const site = headers['sec-fetch-site']
  return site === undefined || SAME_SITE_FETCHES.has(single(site)?.toLowerCase() ?? '')
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export type TokenCheck = (headers: IncomingHttpHeaders) => boolean

/** Compares digests in constant time, so a wrong token's timing says nothing about the right one. */
export function tokenCheck(token: string): TokenCheck {
  const expected = digest(token)
  return (headers) => {
    const match = BEARER.exec(single(headers.authorization) ?? '')
    return match?.[1] !== undefined && timingSafeEqual(digest(match[1]), expected)
  }
}
