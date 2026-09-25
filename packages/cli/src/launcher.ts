/**
 * `verifai` with no command, on a terminal: pick the terminal check or the web UI.
 */

import { runCheck } from './check/command.js'
import { EXIT_CODES, type ExitCode } from './exit-codes.js'
import type { Choice, CliContext } from './io.js'
import { runWeb } from './web/command.js'

type LauncherChoice = 'check' | 'web' | 'exit'

const CHOICES: readonly Choice<LauncherChoice>[] = Object.freeze([
  { value: 'check', label: 'Check an endpoint here', hint: 'in this terminal' },
  { value: 'web', label: 'Open the web UI', hint: 'in your browser, served from 127.0.0.1' },
  { value: 'exit', label: 'Exit' },
])

export async function runLauncher(context: CliContext): Promise<ExitCode> {
  const choice = await context.prompts.select('What would you like to do?', CHOICES, 'check')
  switch (choice) {
    case 'check':
      return runCheck([], context)
    case 'web':
      return runWeb([], context)
    case 'exit':
      return EXIT_CODES.pass
    default:
      context.stderr.write('Cancelled. Nothing was run.\n')
      return EXIT_CODES.cancelled
  }
}
