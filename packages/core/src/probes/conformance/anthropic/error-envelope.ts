/**
 * The shape of the error Anthropic's API returns for a body that is not JSON.
 * Anthropic documents one envelope for every error - `type: "error"`, an
 * `error` object with `type` and `message`, a `request_id` - and a
 * `request-id` header on every response carrying the same identifier. A layer
 * that answers in another vendor's envelope, or in none, has read the request
 * itself before any Claude model could.
 */

import type { ErrorBody } from '../../../adapters/error-body.js'
import {
  ANTHROPIC_ERROR_ENVELOPE,
  ANTHROPIC_REQUEST_ID_HEADER,
} from '../../../sources/anthropic.js'
import {
  ANTHROPIC_ERROR_400,
  ANTHROPIC_REQUEST_ID_IN_BODY,
} from '../../../sources/anthropic-conformance.js'
import { errorOf, header, isSuccess, quoted } from '../../shared.js'
import type { Exchange, LlrTable, Probe, ProbeContext, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  conformanceSignal,
  describeAnswer,
  malformedBody,
} from './shared.js'

const ID = 'conformance/anthropic/error-envelope'

const ENVELOPE_EXPECTED =
  'A 400 invalid_request_error in Anthropic\'s envelope: `type` "error", an `error` object with `type` and `message`, and a `request_id`.'

interface EnvelopeReading {
  readonly llr: LlrTable
  readonly plainLanguage: string
  readonly gaps: readonly string[]
}

function gapsOf(error: ErrorBody): readonly string[] {
  const gaps = error.deviations.map(
    (deviation) =>
      `${deviation.path === '' ? 'the body' : deviation.path} was ${deviation.received} where ${deviation.expected} belongs`,
  )
  return error.requestId === undefined ? [...gaps, 'no request_id field'] : gaps
}

function readEnvelope(exchange: Exchange): EnvelopeReading {
  const error = errorOf(exchange)
  if (isSuccess(exchange) || error === undefined) {
    return {
      llr: {
        translation: { translated: 0.3, direct: -0.3 },
        platform: { 'first-party': -0.4 },
      },
      plainLanguage:
        "The endpoint answered a request that is not valid JSON without the error format Anthropic's API always uses.",
      gaps: [],
    }
  }
  if (error.dialect === 'openai') {
    return {
      llr: {
        translation: { translated: 0.8, direct: -0.6 },
        platform: { 'first-party': -0.3 },
      },
      plainLanguage:
        "The endpoint refused a request that is not valid JSON in OpenAI's error format, not Anthropic's. Something in front of the model reads requests the way OpenAI's API does.",
      gaps: [],
    }
  }
  const gaps = gapsOf(error)
  if (gaps.length > 0) {
    return {
      llr: { platform: { 'first-party': -0.3 } },
      plainLanguage:
        "The endpoint refused a request that is not valid JSON in Anthropic's error format, but with parts of that format missing or changed.",
      gaps,
    }
  }
  return {
    llr: { translation: { direct: 0.3 }, platform: { 'first-party': 0.2 } },
    plainLanguage:
      "The endpoint refused a request that is not valid JSON in exactly the error format Anthropic's API documents.",
    gaps: [],
  }
}

function envelopeSignal(exchange: Exchange): Signal {
  const reading = readEnvelope(exchange)
  const gaps = reading.gaps.length === 0 ? '' : `; ${reading.gaps.join('; ')}`
  return conformanceSignal({
    probeId: ID,
    signalId: 'envelope',
    calibration: 'documented',
    observed: `A body that is not JSON was answered with ${describeAnswer(exchange)}${gaps}.`,
    expected: ENVELOPE_EXPECTED,
    llr: reading.llr,
    plainLanguage: reading.plainLanguage,
    citations: [ANTHROPIC_ERROR_ENVELOPE, ANTHROPIC_ERROR_400],
  })
}

function requestIdSignal(exchange: Exchange): Signal {
  const value = header(exchange, 'request-id')
  const expected =
    "A `request-id` header, such as req_018EeWyXxfu5pfWkrYcMdjWG, equal to the body's `request_id`."
  const citations = [ANTHROPIC_REQUEST_ID_HEADER, ANTHROPIC_REQUEST_ID_IN_BODY] as const
  if (value === undefined) {
    return conformanceSignal({
      probeId: ID,
      signalId: 'request-id-header',
      calibration: 'documented',
      observed: 'The response had no request-id header.',
      expected,
      llr: { platform: { 'first-party': -0.4 } },
      plainLanguage:
        "The endpoint's answer carries no request-id header. Every response from Anthropic's own API carries one.",
      citations,
    })
  }
  const bodyId = errorOf(exchange)?.requestId
  const prefix = value.startsWith('req_') ? 'begins with req_' : 'does not begin with req_'
  const comparison =
    bodyId === undefined
      ? 'the body carries no request_id to compare it with'
      : `the body's request_id is ${quoted(bodyId, 80)}`
  const matches = bodyId === value
  return conformanceSignal({
    probeId: ID,
    signalId: 'request-id-header',
    calibration: 'documented',
    observed: `The request-id header is ${quoted(value, 80)}, which ${prefix}; ${comparison}.`,
    expected,
    llr: bodyId === undefined ? {} : { platform: { 'first-party': matches ? 0.3 : -0.3 } },
    plainLanguage:
      bodyId === undefined
        ? 'The endpoint sent a request-id header, but its answer had no identifier in the body to compare it with.'
        : matches
          ? "The endpoint's request-id header and the identifier in its error agree, as on Anthropic's own API."
          : "The endpoint's request-id header and the identifier in its error differ. On Anthropic's own API they are the same.",
    citations,
  })
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const exchange = await malformedBody(context)
  return Object.freeze([envelopeSignal(exchange), requestIdSignal(exchange)])
}

export const errorEnvelope: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Anthropic's error envelope and request-id header",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  needsKey: true,
  cost: { requests: 1, tokens: 0 },
  citations: [
    ANTHROPIC_ERROR_ENVELOPE,
    ANTHROPIC_REQUEST_ID_HEADER,
    ANTHROPIC_REQUEST_ID_IN_BODY,
    ANTHROPIC_ERROR_400,
  ],
  run,
})
