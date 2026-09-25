/**
 * The ways a probe's request can end other than with a response.
 *
 * A probe lets every one of these through; the runner turns each into the
 * right `skipped` entry, or ends the run. The messages are fixed strings: a
 * message that quoted the endpoint's answer or the request that caused it
 * could carry the buyer's key.
 */

import { type Member, vocabulary } from '../types/vocabulary.js'

/**
 * Answers that mean the check itself is wrong rather than the seller:
 * `invalid-key` for a 401, `model-not-found` for a 404 naming the claimed
 * model, `unreachable` when no request reached the endpoint at all. No report
 * is issued for any of them - a `caution` for a mistyped key would be a false
 * statement about the seller.
 */
export const STOP_REASONS = vocabulary(['invalid-key', 'model-not-found', 'unreachable'])
export type StopReason = Member<typeof STOP_REASONS>

const STOP_MESSAGES: Readonly<Record<StopReason, string>> = Object.freeze({
  'invalid-key': 'The endpoint rejected the API key (HTTP 401). Check the key and try again.',
  'model-not-found':
    'The endpoint says the model does not exist (HTTP 404). Check the model name and try again.',
  unreachable: 'No request reached the endpoint. Check the URL and your network.',
})

/**
 * Thrown by a probe that finds, from what the endpoint answered, that it has
 * nothing to measure - a feature the claimed model does not have. Skipped as
 * `not-applicable`, which is not a gap in the evidence. A refusal the genuine
 * model would not give is a finding, never this.
 */
export class ProbeNotApplicable extends Error {
  override readonly name = 'ProbeNotApplicable'
}

/**
 * A request that failed twice, or was refused with a 403 it was not written
 * to provoke. Skipped as `endpoint-error`, and counted toward `obstructed`.
 */
export class ProbeLost extends Error {
  override readonly name = 'ProbeLost'

  constructor(message = 'The endpoint did not give a usable answer.') {
    super(message)
  }
}

/** The next request would pass the run's request or token budget. */
export class BudgetExceeded extends Error {
  override readonly name = 'BudgetExceeded'

  constructor() {
    super('The next request would exceed the budget for this run.')
  }
}

/** The transport refused the endpoint's address. */
export class TargetBlocked extends Error {
  override readonly name = 'TargetBlocked'

  constructor() {
    super('VerifAI will not connect to this endpoint address.')
  }
}

/** The run was cancelled. */
export class RunAborted extends Error {
  override readonly name = 'RunAborted'

  constructor() {
    super('The run was cancelled.')
  }
}

/** Ends the whole run without a report. See `STOP_REASONS`. */
export class RunStopped extends Error {
  override readonly name = 'RunStopped'
  readonly reason: StopReason

  constructor(reason: StopReason) {
    super(STOP_MESSAGES[reason])
    this.reason = reason
  }
}
