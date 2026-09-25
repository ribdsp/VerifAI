/**
 * `verifai web`: serve the page on loopback, open it, wait for Ctrl+C.
 *
 * The link is the only place the session token appears, so it goes to stdout
 * and nowhere else - not to a log, not to the debug output.
 */

import { parseFlags, UsageError } from '../args.js'
import { DEBUG_ENV } from '../check/command.js'
import { type Assets, loadAssets, MissingWebUi } from '../daemon/assets.js'
import { DaemonStartError, startDaemon } from '../daemon/server.js'
import { EXIT_CODES, type ExitCode } from '../exit-codes.js'
import { WEB_HELP } from '../help.js'
import type { CliContext } from '../io.js'
import { VERSION } from '../version.js'

const WEB_OPTIONS = Object.freeze({
  port: { type: 'string' },
  'no-open': { type: 'boolean' },
  'allow-private-targets': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const)

const MAX_PORT = 65_535

const MISSING_UI =
  'The web UI is not part of this install. Build it with `pnpm --filter @verifai/web build`, or use `verifai check`.'

export interface WebFlags {
  readonly port: number
  readonly open: boolean
  readonly allowPrivateTargets: boolean
  readonly help: boolean
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 0
  }
  const port = /^\d{1,5}$/.test(value) ? Number(value) : Number.NaN
  if (!(port <= MAX_PORT)) {
    throw new UsageError(`--port takes a whole number from 0 to ${MAX_PORT}.`)
  }
  return port
}

/** @throws UsageError for anything but the flags `verifai web` takes. */
export function parseWebFlags(args: readonly string[]): WebFlags {
  const values = parseFlags(args, WEB_OPTIONS, 'verifai web')
  return Object.freeze({
    port: parsePort(values.port),
    open: values['no-open'] !== true,
    allowPrivateTargets: values['allow-private-targets'] === true,
    help: values.help === true,
  })
}

function line(context: CliContext, text: string): void {
  context.stderr.write(`${text}\n`)
}

async function assetsFrom(context: CliContext): Promise<Assets | undefined> {
  try {
    return await loadAssets(context.webRoot)
  } catch (error: unknown) {
    if (error instanceof MissingWebUi) {
      return undefined
    }
    throw error
  }
}

function stopped(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
    } else {
      signal.addEventListener('abort', () => resolve(), { once: true })
    }
  })
}

/** @throws UsageError for a command line that cannot be run as given. */
export async function runWeb(args: readonly string[], context: CliContext): Promise<ExitCode> {
  const flags = parseWebFlags(args)
  if (flags.help) {
    context.stdout.write(WEB_HELP)
    return EXIT_CODES.pass
  }
  const assets = await assetsFrom(context)
  if (assets === undefined) {
    line(context, MISSING_UI)
    return EXIT_CODES.internal
  }
  const debug = context.env[DEBUG_ENV]
  let daemon: Awaited<ReturnType<typeof startDaemon>>
  try {
    daemon = await startDaemon({
      port: flags.port,
      assets,
      allowPrivateTargets: flags.allowPrivateTargets,
      createTransport: context.createTransport,
      version: VERSION,
      ...(context.checkEnvironment === undefined
        ? {}
        : { checkEnvironment: context.checkEnvironment }),
      ...(context.now === undefined ? {} : { now: context.now }),
      ...(debug === undefined || debug === ''
        ? {}
        : { onFailure: (detail) => line(context, detail) }),
    })
  } catch (error: unknown) {
    if (error instanceof DaemonStartError) {
      line(context, error.message)
      return EXIT_CODES.internal
    }
    throw error
  }
  line(context, `VerifAI ${VERSION} is serving its web UI on ${daemon.origin}`)
  if (flags.allowPrivateTargets) {
    line(context, 'Private addresses may be checked from this page, until it stops.')
  }
  line(context, 'Open this link. It carries this session’s token, so keep it to yourself:')
  context.stdout.write(`${daemon.url}\n`)
  if (flags.open && !(await context.openBrowser(daemon.url))) {
    line(context, 'Could not open a browser. Copy the link above into one.')
  }
  line(context, 'Press Ctrl+C to stop.')
  await stopped(context.signal)
  await daemon.close()
  line(context, 'Stopped. Every check this page held, and its key, is gone.')
  return EXIT_CODES.pass
}
