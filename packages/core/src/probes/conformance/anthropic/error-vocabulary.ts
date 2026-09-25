/**
 * Whether the endpoint's error `type`s sit on the statuses Anthropic's error
 * page lists them for. Two requests: a body that is not JSON, and a model id no
 * one serves. A layer that maps another vendor's errors into Anthropic's
 * envelope tends to keep the envelope and lose the pairing.
 *
 * Only answers in Anthropic's envelope are read; `error-envelope` speaks for
 * the rest.
 */

import { modelPath } from '../../../adapters/endpoint.js'
import {
  ANTHROPIC_ERROR_400,
  ANTHROPIC_ERROR_401,
  ANTHROPIC_ERROR_402,
  ANTHROPIC_ERROR_403,
  ANTHROPIC_ERROR_404,
  ANTHROPIC_ERROR_409,
  ANTHROPIC_ERROR_413,
  ANTHROPIC_ERROR_429,
  ANTHROPIC_ERROR_500,
  ANTHROPIC_ERROR_504,
  ANTHROPIC_ERROR_529,
  ANTHROPIC_ERROR_TYPES_MAY_GROW,
} from '../../../sources/anthropic-conformance.js'
import type { Citation } from '../../../sources/citation.js'
import { errorOf, isSuccess } from '../../shared.js'
import type { Exchange, Probe, ProbeContext, Signal } from '../../types.js'
import {
  ANTHROPIC_PROTOCOLS,
  ANTHROPIC_VENDORS,
  conformanceSignal,
  describeAnswer,
  malformedBody,
  uniqueCitations,
} from './shared.js'

const ID = 'conformance/anthropic/error-vocabulary'

interface ErrorRow {
  readonly status: number
  readonly type: string
  readonly source: Citation
}

const row = (status: number, type: string, source: Citation): ErrorRow =>
  Object.freeze({ status, type, source })

/** Anthropic's error page, row by row. */
const ERROR_ROWS: readonly ErrorRow[] = Object.freeze([
  row(400, 'invalid_request_error', ANTHROPIC_ERROR_400),
  row(401, 'authentication_error', ANTHROPIC_ERROR_401),
  row(402, 'billing_error', ANTHROPIC_ERROR_402),
  row(403, 'permission_error', ANTHROPIC_ERROR_403),
  row(404, 'not_found_error', ANTHROPIC_ERROR_404),
  row(409, 'conflict_error', ANTHROPIC_ERROR_409),
  row(413, 'request_too_large', ANTHROPIC_ERROR_413),
  row(429, 'rate_limit_error', ANTHROPIC_ERROR_429),
  row(500, 'api_error', ANTHROPIC_ERROR_500),
  row(504, 'timeout_error', ANTHROPIC_ERROR_504),
  row(529, 'overloaded_error', ANTHROPIC_ERROR_529),
])

const BY_STATUS = new Map(ERROR_ROWS.map((entry) => [entry.status, entry]))
const BY_TYPE = new Map(ERROR_ROWS.map((entry) => [entry.type, entry]))

/** The 400 row's type, which the page allows on any 4XX it does not list. */
const ANY_4XX = 'invalid_request_error'

const isClientError = (status: number): boolean => status >= 400 && status < 500

function fits(status: number, type: string): boolean {
  return BY_STATUS.get(status)?.type === type || (type === ANY_4XX && isClientError(status))
}

function expectedFor(status: number): string {
  const listed = BY_STATUS.get(status)
  if (listed !== undefined) {
    const alternative = status !== 400 && isClientError(status) ? ` or ${ANY_4XX}` : ''
    return `A ${status} carries ${listed.type}${alternative}.`
  }
  return isClientError(status)
    ? `A ${status} carries ${ANY_4XX}, which Anthropic uses for 4XX statuses its list does not name.`
    : `Anthropic's list names no error type for a ${status}.`
}

interface Cell {
  readonly signalId: string
  readonly sent: string
  readonly exchange: Exchange
}

function absentModelAnswered(cell: Cell): Signal {
  return conformanceSignal({
    probeId: ID,
    signalId: cell.signalId,
    calibration: 'documented',
    observed: `${cell.sent} was answered ${cell.exchange.status}.`,
    expected: 'A 404 not_found_error.',
    llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
    plainLanguage:
      "The endpoint answered a request for a model that does not exist as if it did. Anthropic's API answers such a request with a not-found error.",
    citations: [ANTHROPIC_ERROR_404],
  })
}

function cellSignals(cell: Cell): readonly Signal[] {
  const { exchange } = cell
  const error = errorOf(exchange)
  if (error?.dialect !== 'anthropic' || error.type === undefined || isSuccess(exchange)) {
    return []
  }
  const { status } = exchange
  const common = {
    probeId: ID,
    signalId: cell.signalId,
    observed: `${cell.sent} was answered with ${describeAnswer(exchange)}.`,
    expected: expectedFor(status),
  }
  const listed = BY_STATUS.get(status)?.source
  const known = BY_TYPE.get(error.type)
  if (known === undefined) {
    return [
      conformanceSignal({
        ...common,
        calibration: 'heuristic',
        llr: { translation: { translated: 0.1 } },
        plainLanguage: `The endpoint answered with an error type, ${error.type}, that Anthropic's list of error types does not have. Anthropic says the list may grow.`,
        citations: uniqueCitations([
          ...(listed === undefined ? [] : [listed]),
          ANTHROPIC_ERROR_TYPES_MAY_GROW,
        ]),
      }),
    ]
  }
  const consistent = fits(status, error.type)
  return [
    conformanceSignal({
      ...common,
      calibration: 'documented',
      llr: consistent
        ? { platform: { 'first-party': 0.2 } }
        : { platform: { 'first-party': -0.3 }, translation: { translated: 0.3 } },
      plainLanguage: consistent
        ? "The endpoint's error type matches its status code, as on Anthropic's own API."
        : `The endpoint labelled a ${status} with the error type Anthropic uses for a ${known.status}.`,
      citations: uniqueCitations([...(listed === undefined ? [] : [listed]), known.source]),
    }),
  ]
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const malformed = await malformedBody(context)
  const absent = await context.send({
    path: modelPath(`verifai-absent-${context.nonce}`),
    provokes: [404],
  })
  const absentCell: Cell = {
    signalId: 'absent-model-type',
    sent: 'A request for a model id no one serves',
    exchange: absent,
  }
  return Object.freeze([
    ...cellSignals({
      signalId: 'malformed-body-type',
      sent: 'A body that is not JSON',
      exchange: malformed,
    }),
    ...(isSuccess(absent) ? [absentModelAnswered(absentCell)] : cellSignals(absentCell)),
  ])
}

export const errorVocabulary: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Anthropic's error types on their documented statuses",
  group: 'A',
  protocols: ANTHROPIC_PROTOCOLS,
  vendors: ANTHROPIC_VENDORS,
  needsKey: true,
  cost: { requests: 2, tokens: 0 },
  citations: uniqueCitations([
    ...ERROR_ROWS.map((entry) => entry.source),
    ANTHROPIC_ERROR_TYPES_MAY_GROW,
  ]),
  run,
})
