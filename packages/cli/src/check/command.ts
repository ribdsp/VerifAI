/**
 * `verifai check`: prepare, show the estimate, confirm, run, report.
 *
 * Nothing that costs money is sent before the buyer has seen the estimate and
 * said yes, on a terminal or with `--yes`. The report is the only thing that
 * goes to stdout; the conversation around it goes to stderr.
 */

import {
  type ApiError,
  type CheckEnvironment,
  type CheckOutcome,
  HEADLINE_LABELS,
  type PreparedCheck,
  prepareCheck,
  type Report,
  renderJson,
  renderMarkdown,
  renderTerminal,
  vocabulary,
} from '@verifai/core'
import { UsageError } from '../args.js'
import { EXIT_CODES, type ExitCode, exitCodeFor } from '../exit-codes.js'
import { CHECK_HELP } from '../help.js'
import type { CliContext, Spinner } from '../io.js'
import { VERSION } from '../version.js'
import { estimateText, formatCount, formatDuration } from './estimate.js'
import { type CheckFlags, type OutputFormat, parseCheckFlags } from './flags.js'
import { completeRequest } from './request.js'
import { terminalStyle, wantsColour } from './style.js'

/** Set to print the redacted detail of an internal failure, for a bug report. */
export const DEBUG_ENV = 'VERIFAI_DEBUG'

const NEEDS_YES =
  'Without a terminal to confirm in, `verifai check` needs --yes to spend the estimate it prints. Nothing was sent.'

/** Refusals that are the input's fault; the rest are the endpoint's. */
const INPUT_REFUSALS = vocabulary([
  'invalid-request',
  'invalid-endpoint',
  'invalid-api-key',
  'invalid-model',
  'blocked-target',
])

function line(context: CliContext, text: string): void {
  context.stderr.write(`${text}\n`)
}

/** On a terminal a spinner; in a log, one line where a spinner would start and stop. */
function progressFor(context: CliContext): Spinner {
  if (context.interactive) {
    return context.prompts.spinner()
  }
  return Object.freeze({
    start: (message: string) => line(context, `${message}...`),
    message: () => undefined,
    stop: (message: string) => line(context, message),
  })
}

function cancelled(context: CliContext, message = 'Cancelled. No probe was run.'): ExitCode {
  line(context, message)
  return EXIT_CODES.cancelled
}

function refused(error: ApiError, context: CliContext): ExitCode {
  line(context, error.message)
  if (error.code === 'internal') {
    return EXIT_CODES.internal
  }
  return INPUT_REFUSALS.has(error.code) ? EXIT_CODES.usage : EXIT_CODES.stopped
}

async function prepare(
  flags: CheckFlags,
  context: CliContext,
  progress: Spinner,
): Promise<PreparedCheck | ExitCode> {
  const completion = await completeRequest(flags, context)
  if (!completion.ok) {
    return cancelled(context)
  }
  const { request } = completion
  const environment: CheckEnvironment = {
    transport: context.createTransport(request.allowPrivateTargets === true),
    dilutionSupported: true,
    toolVersion: VERSION,
    signal: context.signal,
    ...context.checkEnvironment,
  }
  progress.start('Checking the endpoint and planning the probes')
  const preparation = await prepareCheck(request, environment).catch((error: unknown) => {
    progress.stop('Could not prepare the check')
    throw error
  })
  if (context.signal.aborted) {
    progress.stop('Cancelled')
    if (preparation.ok) {
      preparation.check.discard()
    }
    return cancelled(context)
  }
  if (!preparation.ok) {
    progress.stop('The check cannot run')
    return refused(preparation.error, context)
  }
  progress.stop('Planned')
  const text = estimateText(preparation.check.estimate, request.model)
  if (context.interactive) {
    context.prompts.note(text, 'Nothing has been spent yet')
  } else {
    line(context, text)
  }
  return preparation.check
}

async function confirmed(check: PreparedCheck, flags: CheckFlags, context: CliContext) {
  if (flags.yes) {
    return true
  }
  const { estimate } = check
  const answer = await context.prompts.confirm(
    `Run ${formatCount(estimate.probes.length)} probes, spending up to ${formatCount(estimate.requests)} requests and ${formatCount(estimate.tokens)} tokens?`,
  )
  return answer === true
}

function execute(check: PreparedCheck, context: CliContext, progress: Spinner) {
  const titles = new Map(check.estimate.probes.map((probe) => [probe.id, probe.title]))
  progress.start(`Running ${formatCount(check.estimate.probes.length)} probes`)
  return check.execute({
    signal: context.signal,
    onEvent: (event) => {
      if (event.kind === 'probe-started') {
        const title = titles.get(event.probeId) ?? event.probeId
        progress.message(`${event.index + 1}/${event.total} ${title}`)
      } else if (event.kind === 'waiting') {
        progress.message(`Waiting ${formatDuration(event.waitMs)} before the next request`)
      }
    },
    ...(context.now === undefined ? {} : { now: context.now }),
  })
}

function render(report: Report, format: OutputFormat, colour: boolean): string {
  switch (format) {
    case 'json':
      return renderJson(report)
    case 'markdown':
      return renderMarkdown(report)
    default:
      return renderTerminal(report, terminalStyle(colour))
  }
}

async function deliver(report: Report, flags: CheckFlags, context: CliContext): Promise<void> {
  const toStdout = flags.out === undefined
  const colour = toStdout && wantsColour(context.stdout.isTTY, context.env)
  const rendered = render(report, flags.format, colour)
  const text = rendered.endsWith('\n') ? rendered : `${rendered}\n`
  if (flags.out === undefined) {
    context.stdout.write(text)
  } else {
    await context.writeFile(flags.out, text)
    line(context, `Report written to ${flags.out}`)
  }
  if (!(toStdout && flags.format === 'terminal')) {
    line(context, `Verdict: ${HEADLINE_LABELS[report.verdict.headline]}`)
  }
}

async function finish(
  outcome: CheckOutcome,
  flags: CheckFlags,
  context: CliContext,
  progress: Spinner,
): Promise<ExitCode> {
  switch (outcome.state) {
    case 'finished':
      progress.stop(
        `Finished: ${formatCount(outcome.requests)} requests, ${formatCount(outcome.tokens)} tokens`,
      )
      await deliver(outcome.report, flags, context)
      return exitCodeFor(outcome.report.verdict.headline)
    case 'cancelled':
      progress.stop('Cancelled')
      return cancelled(
        context,
        `Cancelled after ${formatCount(outcome.requests)} requests. No report was issued.`,
      )
    case 'stopped':
      progress.stop('Stopped')
      line(context, outcome.error.message)
      if (outcome.suggestsBearer) {
        line(context, 'Run again with --auth bearer.')
      }
      return EXIT_CODES.stopped
    default: {
      progress.stop('Failed')
      line(context, outcome.error.message)
      const debug = context.env[DEBUG_ENV]
      if (debug !== undefined && debug !== '') {
        line(context, outcome.detail)
      }
      return EXIT_CODES.internal
    }
  }
}

/** @throws UsageError for a command line or input that cannot be run as given. */
export async function runCheck(args: readonly string[], context: CliContext): Promise<ExitCode> {
  const flags = parseCheckFlags(args)
  if (flags.help) {
    context.stdout.write(CHECK_HELP)
    return EXIT_CODES.pass
  }
  if (!(context.interactive || flags.yes)) {
    throw new UsageError(NEEDS_YES)
  }
  if (context.interactive) {
    context.prompts.intro('VerifAI check')
  }
  // A spinner per phase: clack's is not meant to be started again once stopped.
  const prepared = await prepare(flags, context, progressFor(context))
  if (typeof prepared === 'number') {
    return prepared
  }
  if (!(await confirmed(prepared, flags, context)) || context.signal.aborted) {
    prepared.discard()
    return cancelled(context)
  }
  const progress = progressFor(context)
  const outcome = await execute(prepared, context, progress)
  return finish(outcome, flags, context, progress)
}
