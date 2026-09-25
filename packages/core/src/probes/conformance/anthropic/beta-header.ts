/**
 * What the endpoint does with an `anthropic-beta` header naming a beta that
 * does not exist. Anthropic documents a 400 whose message names the value
 * back. A layer that forwards only the headers it knows drops it, and the
 * request succeeds. The name carries the run's nonce, so no layer can have
 * learned it in advance, and follows Anthropic's `feature-name-YYYY-MM-DD`
 * pattern, so it cannot be refused for its shape alone.
 */

import {
  ANTHROPIC_BETA_INVALID,
  ANTHROPIC_BETA_INVALID_MESSAGE,
  ANTHROPIC_BETA_NAME_PATTERN,
} from '../../../sources/anthropic-conformance.js'
import { errorOf, isSuccess } from '../../shared.js'
import type { Exchange, LlrTable, Probe, ProbeContext, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  CELL_TOKENS,
  conformanceSignal,
  describeAnswer,
  refusableRequest,
} from './shared.js'

const ID = 'conformance/anthropic/beta-header'

const BETA_DATE = '2026-09-24'
const CITATIONS = [
  ANTHROPIC_BETA_INVALID,
  ANTHROPIC_BETA_INVALID_MESSAGE,
  ANTHROPIC_BETA_NAME_PATTERN,
] as const

interface Reading {
  readonly signalId: string
  readonly llr: LlrTable
  readonly plainLanguage: string
}

function read(exchange: Exchange, refusedByName: boolean): Reading {
  if (isSuccess(exchange)) {
    return {
      signalId: 'accepted',
      llr: { translation: { translated: 0.3, direct: -0.3 }, platform: { 'first-party': -0.4 } },
      plainLanguage:
        "The endpoint answered a request naming a beta feature that does not exist. Anthropic's API refuses such a request, so the header did not reach it unchanged.",
    }
  }
  if (refusedByName) {
    return {
      signalId: 'refused-as-anthropic',
      llr: { translation: { direct: 0.4 }, platform: { 'first-party': 0.3 } },
      plainLanguage:
        "The endpoint refused a beta feature that does not exist, naming it back in the words Anthropic's API uses.",
    }
  }
  if (exchange.status === 400) {
    return {
      signalId: 'refused-otherwise',
      llr: { translation: { translated: 0.2 }, platform: { 'first-party': -0.2 } },
      plainLanguage:
        "The endpoint refused the request, but not with the message Anthropic's API gives for a beta feature that does not exist.",
    }
  }
  return {
    signalId: 'other-status',
    llr: {},
    plainLanguage:
      'The endpoint answered with a status that neither confirms nor contradicts how Anthropic handles an unknown beta feature.',
  }
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const name = `verifai-probe-${context.nonce}-${BETA_DATE}`
  const request = refusableRequest(context.target, {})
  const exchange = await context.send({
    ...request,
    headers: [...(request.headers ?? []), ['anthropic-beta', name]],
  })
  const wording = `Unexpected value(s) \`${name}\` for the \`anthropic-beta\` header.`
  const error = errorOf(exchange)
  const refusedByName =
    exchange.status === 400 &&
    error?.dialect === 'anthropic' &&
    error.type === 'invalid_request_error' &&
    error.message.includes(wording)
  const reading = read(exchange, refusedByName)
  return [
    conformanceSignal({
      probeId: ID,
      signalId: reading.signalId,
      calibration: 'documented',
      observed: `A request with \`anthropic-beta: ${name}\` was answered with ${describeAnswer(exchange)}.`,
      expected: `A 400 invalid_request_error with the message "${wording} Please consult our documentation at platform.claude.com/docs or try again without the header."`,
      llr: reading.llr,
      plainLanguage: reading.plainLanguage,
      citations: CITATIONS,
    }),
  ]
}

export const betaHeader: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Anthropic's refusal of an unknown beta header",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  needsKey: true,
  cost: { requests: 1, tokens: CELL_TOKENS },
  citations: CITATIONS,
  run,
})
