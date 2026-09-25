/**
 * What `verifai` tells a script through its exit status.
 *
 * A verdict is not an error, so the three verdicts get codes of their own well
 * away from the conventional 1 and 2: a CI job can fail on `fail` alone, or on
 * anything but `pass`, without mistaking a VerifAI crash for a finding.
 */

import type { Verdict } from '@verifai/core'

export const EXIT_CODES = Object.freeze({
  pass: 0,
  /** VerifAI itself failed. Nothing was concluded about the endpoint. */
  internal: 1,
  /** The command line or the input was wrong. Nothing was sent. */
  usage: 2,
  /** The endpoint refused the key or the model, or could not be reached. No report. */
  stopped: 3,
  caution: 10,
  fail: 11,
  /** Ctrl+C, a declined confirmation, or a cancelled prompt. */
  cancelled: 130,
})

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]

export function exitCodeFor(verdict: Verdict): ExitCode {
  return EXIT_CODES[verdict]
}
