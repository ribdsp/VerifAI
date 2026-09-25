/**
 * Everything a command touches outside its own arguments, passed in rather
 * than reached for, so a test can run the real command against a fake world.
 *
 * Prompts, progress and messages go to `stderr`; only a report goes to
 * `stdout`. `verifai check --format json > report.json` therefore writes a
 * clean file even when the run asked questions on the way.
 */

import type { CheckEnvironment, Transport } from '@verifai/core'

export interface Output {
  readonly write: (text: string) => void
  /** Whether escape codes make sense on this stream. */
  readonly isTTY: boolean
}

export interface Choice<T extends string> {
  readonly value: T
  readonly label: string
  readonly hint?: string
}

export interface TextOptions {
  readonly placeholder?: string
  /** A problem to show, or `undefined` for a value that is fine. */
  readonly validate?: (value: string) => string | undefined
}

export interface Spinner {
  readonly start: (message: string) => void
  readonly message: (message: string) => void
  readonly stop: (message: string) => void
}

/** Every prompt resolves `undefined` when the buyer cancels it. */
export interface Prompts {
  readonly intro: (title: string) => void
  readonly outro: (message: string) => void
  readonly note: (message: string, title: string) => void
  readonly select: <T extends string>(
    message: string,
    choices: readonly Choice<T>[],
    initial?: T,
  ) => Promise<T | undefined>
  readonly text: (message: string, options?: TextOptions) => Promise<string | undefined>
  /** Masked input. The value is never echoed, and never validated in the prompt. */
  readonly password: (message: string) => Promise<string | undefined>
  readonly confirm: (message: string) => Promise<boolean | undefined>
  readonly spinner: () => Spinner
}

export interface CliContext {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdout: Output
  readonly stderr: Output
  /** Whether a person is there to answer: stdin and stderr are both terminals. */
  readonly interactive: boolean
  readonly prompts: Prompts
  readonly createTransport: (allowPrivateTargets: boolean) => Transport
  readonly writeFile: (path: string, content: string) => Promise<void>
  /** Resolves `false` when no browser could be started. */
  readonly openBrowser: (url: string) => Promise<boolean>
  /** Aborted on Ctrl+C. */
  readonly signal: AbortSignal
  /** The built web UI: a directory holding `index.html` and `assets/`. */
  readonly webRoot: string
  /** Wall-clock milliseconds. */
  readonly now?: () => number
  /** Narrows what a check runs with; tests use it for a small catalogue. */
  readonly checkEnvironment?: Partial<CheckEnvironment>
}
