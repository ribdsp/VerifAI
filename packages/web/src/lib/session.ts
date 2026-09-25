/**
 * The session token `verifai web` hands the page in its URL fragment.
 *
 * A fragment never reaches a server or a `Referer`, which is why the daemon
 * puts the token there. The page reads it once, strips it from the address
 * bar so it does not end up in history or a screenshot, and keeps it in this
 * module and nowhere else. A reload therefore loses it, on purpose: the
 * terminal that started the daemon prints a fresh link.
 */

import { TOKEN_FRAGMENT_KEY } from '@verifai/core'

/** URL-safe and header-safe, and long enough to be random rather than typed. */
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/

let token: string | undefined

export interface SessionLocation {
  readonly hash: string
  readonly pathname: string
  readonly search: string
}

export interface SessionHistory {
  readonly replaceState: (data: unknown, unused: string, url?: string | null) => void
}

/** `#token=<value>` gives the value; anything else, including a malformed token, gives nothing. */
export function tokenFromHash(hash: string): string | undefined {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  const value = new URLSearchParams(fragment).get(TOKEN_FRAGMENT_KEY)
  if (value === null || !TOKEN_PATTERN.test(value)) {
    return undefined
  }
  return value
}

/**
 * Reads the token from the fragment and removes the fragment from the address
 * bar. Returns the token this page holds, which survives a second call.
 */
export function takeSessionToken(
  location: SessionLocation,
  history: SessionHistory,
): string | undefined {
  const found = tokenFromHash(location.hash)
  if (location.hash !== '') {
    history.replaceState(null, '', `${location.pathname}${location.search}`)
  }
  if (found !== undefined) {
    token = found
  }
  return token
}

export function sessionToken(): string | undefined {
  return token
}

/** For tests: forget the token this module holds. */
export function forgetSessionToken(): void {
  token = undefined
}
