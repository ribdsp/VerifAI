/**
 * Prepared checks whose run the test finishes by hand, so a store can be
 * caught mid-run: busy, cancelled, or failing in a way core never would.
 */

import type {
  CheckOutcome,
  CheckRequest,
  ExecuteOptions,
  PreparedCheck,
  Report,
} from '@verifai/core'
import { prepareCheck } from '@verifai/core'
import { fakeTransport, jsonResponse } from '../../../core/test/fakes/transport.js'
import { CATALOGUE, KEY } from './context.js'

export const REQUEST: CheckRequest = Object.freeze({
  endpoint: 'https://gateway.example/v1',
  apiKey: KEY,
  model: 'claude-opus-5-5',
  vendor: 'anthropic',
  protocol: 'anthropic-messages',
  profile: 'quick',
})

/** A real check against a fake endpoint that answers everything with 200. */
export async function realCheck(request: CheckRequest = REQUEST): Promise<PreparedCheck> {
  const preparation = await prepareCheck(request, {
    transport: fakeTransport(() => jsonResponse(200, { ok: true })),
    dilutionSupported: false,
    toolVersion: '0.0.0',
    catalogue: CATALOGUE,
  })
  if (!preparation.ok) {
    throw new Error(`Test check refused: ${preparation.error.code}`)
  }
  return preparation.check
}

/** A real run's report, for outcomes the test settles by hand. */
export async function realReport(): Promise<Report> {
  const outcome = await (await realCheck()).execute()
  if (outcome.state !== 'finished') {
    throw new Error(`Test run ended ${outcome.state}`)
  }
  return outcome.report
}

export interface ControlledCheck {
  readonly check: PreparedCheck
  readonly discarded: () => boolean
  /** What `execute` was called with, once it has been. */
  readonly started: () => ExecuteOptions | undefined
  readonly settle: (outcome: CheckOutcome) => void
  readonly reject: (error: unknown) => void
}

export async function controlledCheck(): Promise<ControlledCheck> {
  const real = await realCheck()
  let discarded = false
  let options: ExecuteOptions | undefined
  let settle: (outcome: CheckOutcome) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const outcome = new Promise<CheckOutcome>((resolve, fail) => {
    settle = resolve
    reject = fail
  })
  const check: PreparedCheck = Object.freeze({
    ...real,
    execute: (given: ExecuteOptions = {}) => {
      options = given
      return outcome
    },
    discard: () => {
      discarded = true
      real.discard()
    },
  })
  return Object.freeze({
    check,
    discarded: () => discarded,
    started: () => options,
    settle: (value: CheckOutcome) => settle(value),
    reject: (error: unknown) => reject(error),
  })
}

/** Lets the promise callbacks a settled run queued, run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
