/**
 * The headers an adapter's requests share: authentication, content type and
 * the JSON `Accept` both vendors' official SDKs send on every request. Casing
 * follows each vendor's own curl examples.
 */

import type { HeaderPair } from '../transport/types.js'
import type { AuthScheme } from './types.js'

export const JSON_CONTENT_TYPE: HeaderPair = Object.freeze(['Content-Type', 'application/json'])

/**
 * Sent with or without a body, as the official SDKs send it. Some platforms,
 * Snowflake Cortex among them, answer a request without it with an HTML page.
 */
export const JSON_ACCEPT: HeaderPair = Object.freeze(['Accept', 'application/json'])

/**
 * The header carrying the key, or none for a probe that deliberately sends no
 * key.
 *
 * @throws TypeError for a scheme the protocol does not document, whether or
 * not there is a key, so that a misconfigured scheme never passes unnoticed
 * through a keyless probe. The message names the scheme, never the key.
 */
export function credentialHeaders(
  supported: readonly AuthScheme[],
  scheme: AuthScheme,
  apiKey: string | undefined,
): readonly HeaderPair[] {
  if (!supported.includes(scheme)) {
    throw new TypeError(`Auth scheme ${scheme} is not one this protocol documents`)
  }
  if (apiKey === undefined) {
    return []
  }
  const pair: HeaderPair =
    scheme === 'bearer' ? ['Authorization', `Bearer ${apiKey}`] : ['X-Api-Key', apiKey]
  return [Object.freeze(pair)]
}
