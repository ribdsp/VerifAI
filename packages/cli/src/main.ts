/**
 * Dispatch: a command line and a context in, an exit code out.
 *
 * Every failure ends here. A usage error is the buyer's to fix and is shown
 * as it is; anything else is VerifAI's, and is shown as a fixed message,
 * because an error from deep inside may be quoting what it was handed.
 */

import { parseFlags, UsageError } from './args.js'
import { DEBUG_ENV, runCheck } from './check/command.js'
import { EXIT_CODES, type ExitCode } from './exit-codes.js'
import { MAIN_HELP } from './help.js'
import type { CliContext } from './io.js'
import { runLauncher } from './launcher.js'
import { VERSION } from './version.js'
import { runWeb } from './web/command.js'

const MAIN_OPTIONS = Object.freeze({
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const)

/** A command is named back only when it looks like one, never like a pasted secret. */
const COMMAND_NAME = /^[a-z][a-z-]{0,19}$/

const INTERNAL_MESSAGE = `VerifAI failed unexpectedly; nothing was concluded. Set ${DEBUG_ENV}=1 to print where, for a bug report.`

function topLevel(args: readonly string[], context: CliContext): ExitCode {
  const flags = parseFlags(args, MAIN_OPTIONS, 'verifai')
  if (flags.version === true) {
    context.stdout.write(`${VERSION}\n`)
  } else {
    context.stdout.write(MAIN_HELP)
  }
  return EXIT_CODES.pass
}

/** `verifai help`, and `verifai help <command>` for that command's own. */
function helpFor(rest: readonly string[], context: CliContext): Promise<ExitCode> | ExitCode {
  const [topic, ...extra] = rest
  if (extra.length === 0) {
    switch (topic) {
      case undefined:
        return topLevel([], context)
      case 'check':
        return runCheck(['--help'], context)
      case 'web':
        return runWeb(['--help'], context)
      default:
        break
    }
  }
  throw new UsageError('`verifai help` takes one command: check or web.')
}

function dispatch(argv: readonly string[], context: CliContext): Promise<ExitCode> | ExitCode {
  const [command, ...rest] = argv
  if (command === undefined) {
    if (context.interactive) {
      return runLauncher(context)
    }
    context.stderr.write(MAIN_HELP)
    return EXIT_CODES.usage
  }
  if (command.startsWith('-')) {
    return topLevel(argv, context)
  }
  switch (command) {
    case 'check':
      return runCheck(rest, context)
    case 'web':
      return runWeb(rest, context)
    case 'help':
      return helpFor(rest, context)
    default: {
      const named = COMMAND_NAME.test(command) ? ` "${command}"` : ''
      throw new UsageError(`Unknown command${named}. Run \`verifai --help\` for the list.`)
    }
  }
}

/** Where it failed, without the message: the stack's frames name code, never input. */
function framesOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'non-error thrown'
  }
  const frames = (error.stack ?? '').split('\n').filter((frame) => /^\s+at /.test(frame))
  return [error.name, ...frames].join('\n')
}

export async function main(argv: readonly string[], context: CliContext): Promise<ExitCode> {
  try {
    return await dispatch(argv, context)
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      context.stderr.write(`verifai: ${error.message}\n`)
      return EXIT_CODES.usage
    }
    context.stderr.write(`verifai: ${INTERNAL_MESSAGE}\n`)
    const debug = context.env[DEBUG_ENV]
    if (debug !== undefined && debug !== '') {
      context.stderr.write(`${framesOf(error)}\n`)
    }
    return EXIT_CODES.internal
  }
}
