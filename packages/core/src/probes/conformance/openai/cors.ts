/**
 * How the endpoint handles browser CORS: the preflight it answers for Chat
 * Completions, and the `Access-Control-Expose-Headers` it sends on a 401.
 * OpenAI's edge answers the preflight with a fixed method list and a day-long
 * cache, and sends its expose header twice.
 *
 * Only what is there is read. A browser hides response headers the server
 * does not expose, so a missing header is no finding; a header that is present
 * with other contents, or a refused preflight, is.
 */

import {
  MEASURED_OPENAI_EXPOSE_HEADERS_TWICE,
  MEASURED_OPENAI_PREFLIGHT,
} from '../../../sources/measured-conformance.js'
import { header, headers, quoted } from '../../shared.js'
import type { Exchange, Probe, ProbeContext, Signal } from '../../types.js'
import { noKeyExchange, OPENAI_PROTOCOLS, observedSignal } from './shared.js'

const ID = 'conformance/openai/cors'

const ALLOW_METHODS = 'GET, OPTIONS, POST'
const MAX_AGE = '86400'
const EXPOSED = 'cf-ray'

const PREFLIGHT_EXPECTED = `200, access-control-allow-methods: ${ALLOW_METHODS}, access-control-max-age: ${MAX_AGE}.`

function preflight(context: ProbeContext): Promise<Exchange> {
  return context.send({
    path: 'chat/completions',
    method: 'OPTIONS',
    credential: 'none',
    headers: [
      ['Origin', 'https://example.com'],
      ['Access-Control-Request-Method', 'POST'],
      ['Access-Control-Request-Headers', 'authorization, content-type'],
    ],
  })
}

function describePreflight(
  exchange: Exchange,
  methods: string | undefined,
  maxAge: string | undefined,
): string {
  const shown = (value: string | undefined) => (value === undefined ? 'absent' : quoted(value))
  return `${exchange.status}, access-control-allow-methods: ${shown(methods)}, access-control-max-age: ${shown(maxAge)}.`
}

function readPreflight(exchange: Exchange): Signal | undefined {
  const methods = header(exchange, 'access-control-allow-methods')?.trim()
  const maxAge = header(exchange, 'access-control-max-age')?.trim()
  const observed = describePreflight(exchange, methods, maxAge)
  if (exchange.status === 200 && methods === ALLOW_METHODS && maxAge === MAX_AGE) {
    return observedSignal(ID, MEASURED_OPENAI_PREFLIGHT, {
      signalId: 'preflight-match',
      observed,
      expected: PREFLIGHT_EXPECTED,
      llr: { platform: { 'first-party': 0.2 }, translation: { direct: 0.1 } },
      plainLanguage:
        "The endpoint answers a browser's permission check exactly as OpenAI's own servers do.",
    })
  }
  const differs =
    exchange.status >= 400 ||
    (methods !== undefined && methods !== ALLOW_METHODS) ||
    (maxAge !== undefined && maxAge !== MAX_AGE)
  if (!differs) {
    return undefined
  }
  return observedSignal(ID, MEASURED_OPENAI_PREFLIGHT, {
    signalId: 'preflight-mismatch',
    observed,
    expected: PREFLIGHT_EXPECTED,
    llr: { platform: { 'first-party': -0.1 } },
    plainLanguage:
      "The endpoint answers a browser's permission check differently from OpenAI's own servers. It says nothing about the model behind it.",
  })
}

/** Duplicate headers may arrive as one comma-joined value, so tokens are counted, not headers. */
function exposedCount(exchange: Exchange): number {
  return headers(exchange, 'access-control-expose-headers')
    .flatMap((value) => value.split(','))
    .filter((token) => token.trim().toLowerCase() === EXPOSED).length
}

function readExposed(exchange: Exchange): Signal | undefined {
  const count = exposedCount(exchange)
  if (exchange.status !== 401 || count < 2) {
    return undefined
  }
  return observedSignal(ID, MEASURED_OPENAI_EXPOSE_HEADERS_TWICE, {
    signalId: 'expose-headers-duplicated',
    observed: `The 401 from GET models exposes CF-Ray ${count} times.`,
    expected: 'Access-Control-Expose-Headers: CF-Ray, sent twice.',
    llr: { platform: { 'first-party': 0.2 } },
    plainLanguage: "The endpoint sends one header twice over, exactly as OpenAI's own servers do.",
  })
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const answered = await preflight(context)
  const unauthenticated = await noKeyExchange(context, 'get-models')
  return [readPreflight(answered), readExposed(unauthenticated)].filter(
    (found): found is Signal => found !== undefined,
  )
}

export const cors: Probe = Object.freeze<Probe>({
  id: ID,
  title: "OpenAI's CORS answers",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  needsKey: false,
  cost: { requests: 2, tokens: 0 },
  citations: [MEASURED_OPENAI_PREFLIGHT, MEASURED_OPENAI_EXPOSE_HEADERS_TWICE],
  run,
})
