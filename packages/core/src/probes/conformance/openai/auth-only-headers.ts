/**
 * Which of OpenAI's documented response headers come back on a 401 to a
 * request without a key. OpenAI's edge sends `x-request-id` there and holds
 * back `openai-organization`, `openai-processing-ms` and `openai-version`,
 * which exist only once a key has named an organization. A 401 that carries
 * them was not written by that edge.
 *
 * A missing header is no finding: a browser hides the ones the server does not
 * expose, so only headers that are present are read.
 */

import { MEASURED_OPENAI_UNAUTHENTICATED_HEADERS } from '../../../sources/measured-conformance.js'
import { header, quoted } from '../../shared.js'
import type { Probe, ProbeContext, Signal } from '../../types.js'
import { noKeyExchange, OPENAI_PROTOCOLS, observedSignal } from './shared.js'

const ID = 'conformance/openai/auth-only-headers'

const AUTHENTICATED_ONLY: readonly string[] = Object.freeze([
  'openai-organization',
  'openai-processing-ms',
  'openai-version',
])

const REQUEST_ID = /^req_[0-9a-f]{32}$/

const EXPECTED =
  'x-request-id as req_ and 32 lowercase hex digits; no openai-organization, openai-processing-ms or openai-version.'

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const exchange = await noKeyExchange(context, 'get-models')
  if (exchange.status !== 401) {
    return []
  }
  const leaked = AUTHENTICATED_ONLY.filter((name) => header(exchange, name) !== undefined)
  if (leaked.length > 0) {
    return [
      observedSignal(ID, MEASURED_OPENAI_UNAUTHENTICATED_HEADERS, {
        signalId: 'authenticated-headers-present',
        observed: `The 401 from GET models without a key carries ${leaked.join(', ')}.`,
        expected: EXPECTED,
        llr: { platform: { 'first-party': -0.3 } },
        plainLanguage:
          "The endpoint's refusal of a request without a key carries headers that OpenAI's own servers send only after accepting a key.",
      }),
    ]
  }
  const requestId = header(exchange, 'x-request-id')
  if (requestId === undefined) {
    return []
  }
  const matches = REQUEST_ID.test(requestId)
  return [
    observedSignal(ID, MEASURED_OPENAI_UNAUTHENTICATED_HEADERS, {
      signalId: matches ? 'request-id-match' : 'request-id-mismatch',
      observed: `The 401 from GET models without a key carries x-request-id: ${quoted(requestId)} and none of ${AUTHENTICATED_ONLY.join(', ')}.`,
      expected: EXPECTED,
      llr: { platform: { 'first-party': matches ? 0.2 : -0.1 } },
      plainLanguage: matches
        ? "The endpoint's refusal of a request without a key carries the same headers, in the same format, as OpenAI's own servers send."
        : "The endpoint's refusal of a request without a key carries a request id in a different format from OpenAI's own. It says nothing about the model behind it.",
    }),
  ]
}

export const authOnlyHeaders: Probe = Object.freeze<Probe>({
  id: ID,
  title: "OpenAI's headers on an unauthenticated 401",
  group: 'A',
  protocols: OPENAI_PROTOCOLS,
  vendors: ['openai'],
  needsKey: false,
  cost: { requests: 1, tokens: 0 },
  citations: [MEASURED_OPENAI_UNAUTHENTICATED_HEADERS],
  run,
})
