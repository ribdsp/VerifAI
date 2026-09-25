#!/usr/bin/env node

/**
 * The `verifai` executable: the real world, wired into `main`.
 *
 * The first Ctrl+C asks the running command to stop - a check cancels between
 * requests, the daemon closes and drops its keys. A second one exits at once.
 */

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createNodeTransport } from '@verifai/node'
import { EXIT_CODES } from './exit-codes.js'
import type { CliContext, Output } from './io.js'
import { main } from './main.js'
import { createClackPrompts } from './prompts.js'
import { USER_AGENT } from './version.js'
import { openBrowser } from './web/open.js'

function output(stream: NodeJS.WriteStream): Output {
  return Object.freeze({ write: (text: string) => void stream.write(text), isTTY: stream.isTTY })
}

const interrupt = new AbortController()
let interrupts = 0
const onSignal = () => {
  interrupts += 1
  if (interrupts > 1) {
    process.exit(EXIT_CODES.cancelled)
  }
  interrupt.abort()
}
process.on('SIGINT', onSignal)
process.on('SIGTERM', onSignal)

const context: CliContext = {
  env: process.env,
  stdout: output(process.stdout),
  stderr: output(process.stderr),
  interactive: process.stdin.isTTY === true && process.stderr.isTTY,
  prompts: createClackPrompts(process.stdin, process.stderr),
  createTransport: (allowPrivateTargets) =>
    createNodeTransport({ allowPrivateTargets, userAgent: USER_AGENT }),
  writeFile: (path, content) => writeFile(path, content, 'utf8'),
  openBrowser: (url) => openBrowser(url),
  signal: interrupt.signal,
  // Copied next to this file at build time; see tsdown.config.ts.
  webRoot: fileURLToPath(new URL('./web/', import.meta.url)),
}

process.exitCode = await main(process.argv.slice(2), context)
