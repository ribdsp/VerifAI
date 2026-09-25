/**
 * Probes made to order, for testing the runner and the scoring above it.
 *
 * Each does one thing - sends what it is given, returns what it is told - so a
 * runner test says what the endpoint does and what should follow, and nothing
 * about how a real probe reads an answer.
 */

import { signal } from '../../src/probes/shared.js'
import type {
  DilutionPlan,
  DilutionProbe,
  Exchange,
  LlrTable,
  Probe,
  ProbeContext,
  ProbeGroup,
  ProbeRequest,
  Signal,
  SignalFamily,
} from '../../src/probes/types.js'
import { citation } from '../../src/sources/citation.js'
import type { Protocol, Vendor } from '../../src/types/target.js'

export const TEST_CITATION = citation(
  'https://platform.claude.com/docs/en/api/messages',
  'A test quote that stands in for a vendor sentence.',
  '2026-09-01',
)

const ALL_PROTOCOLS: readonly Protocol[] = Object.freeze([
  'anthropic-messages',
  'openai-chat',
  'openai-responses',
])
const ALL_VENDORS: readonly Vendor[] = Object.freeze(['anthropic', 'openai'])

export interface SignalOptions {
  readonly signalId?: string
  readonly family?: SignalFamily
  readonly llr?: LlrTable
}

export function testSignal(probeId: string, options: SignalOptions = {}): Signal {
  return signal({
    probeId,
    signalId: options.signalId ?? 'observed',
    family: options.family ?? 'protocol-conformance',
    calibration: 'documented',
    observed: 'The endpoint answered as the test says.',
    expected: 'The endpoint answers as the test says.',
    llr: options.llr ?? { identity: { 'matches-claim': 0.5 } },
    plainLanguage: 'A test signal.',
    citations: [TEST_CITATION] as const,
  })
}

export interface ProbeOptions {
  readonly group?: Exclude<ProbeGroup, 'F'>
  readonly needsKey?: boolean
  readonly requests?: readonly ProbeRequest[]
  /** Given every exchange; returns the signals. Defaults to one signal. */
  readonly read?: (exchanges: readonly Exchange[], context: ProbeContext) => readonly Signal[]
}

export const MESSAGES_REQUEST: ProbeRequest = Object.freeze({
  path: 'messages',
  body: { json: { model: 'claude-opus-5-5' } },
  tokens: 10,
})

/** Sends `requests` in order, then reads them. */
export function testProbe(id: string, options: ProbeOptions = {}): Probe {
  const requests = options.requests ?? [MESSAGES_REQUEST]
  return Object.freeze({
    id,
    title: `Test probe ${id}`,
    group: options.group ?? 'A',
    protocols: ALL_PROTOCOLS,
    vendors: ALL_VENDORS,
    needsKey: options.needsKey ?? false,
    cost: { requests: requests.length, tokens: 10 * requests.length },
    citations: [TEST_CITATION] as const,
    run: async (context: ProbeContext) => {
      const exchanges: Exchange[] = []
      for (const request of requests) {
        exchanges.push(await context.send(request))
      }
      return options.read === undefined ? [testSignal(id)] : options.read(exchanges, context)
    },
  })
}

/** A probe whose `run` is entirely the test's. */
export function customProbe(
  id: string,
  run: (context: ProbeContext) => Promise<readonly Signal[]>,
  group: Exclude<ProbeGroup, 'F'> = 'A',
): Probe {
  return Object.freeze({ ...testProbe(id, { group }), run })
}

export interface DilutionOptions {
  readonly basis?: DilutionPlan['basis']
  readonly reference?: string
  readonly requestsPerDraw?: number
  /** Requests each draw sends. Defaults to `requestsPerDraw` copies of one request. */
  readonly drawRequests?: number
  /** Reads a draw from its exchanges; the default reads the body text. */
  readonly read?: (exchanges: readonly Exchange[]) => string | undefined
  readonly prepare?: (context: ProbeContext) => Promise<void>
  readonly conclude?: (readings: readonly string[]) => readonly Signal[]
}

export const DILUTION_ID = 'dilution/test'

export const DRAW_REQUEST: ProbeRequest = Object.freeze({
  path: 'messages/count_tokens',
  body: { json: { model: 'claude-opus-5-5' } },
})

export function testDilutionProbe(options: DilutionOptions = {}): DilutionProbe {
  const requestsPerDraw = options.requestsPerDraw ?? 1
  const drawRequests = options.drawRequests ?? requestsPerDraw
  const basis = options.basis ?? 'reference'
  return Object.freeze({
    id: DILUTION_ID,
    title: 'Test dilution probe',
    group: 'F',
    protocols: ALL_PROTOCOLS,
    vendors: ALL_VENDORS,
    needsKey: false,
    requestsPerDraw,
    cost: { requests: requestsPerDraw, tokens: 0 },
    citations: [TEST_CITATION] as const,
    prepare: async (context: ProbeContext): Promise<DilutionPlan> => {
      await options.prepare?.(context)
      return Object.freeze({
        basis,
        measures: 'the body of a test response',
        ...(basis === 'reference' ? { reference: options.reference ?? 'genuine' } : {}),
        read: async (draw: ProbeContext) => {
          const exchanges: Exchange[] = []
          for (let index = 0; index < drawRequests; index += 1) {
            exchanges.push(await draw.send(DRAW_REQUEST))
          }
          return options.read === undefined
            ? exchanges.map((exchange) => exchange.text ?? '').join('|')
            : options.read(exchanges)
        },
        conclude: options.conclude ?? (() => [testSignal(DILUTION_ID, { signalId: 'uniform' })]),
      })
    },
  })
}
