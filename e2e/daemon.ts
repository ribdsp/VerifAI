import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The built `verifai web`, started as a buyer starts it, on a port the OS picks. */

const BIN = fileURLToPath(new URL('../packages/cli/dist/bin.js', import.meta.url))
const DAEMON_LINK = /^http:\/\/127\.0\.0\.1:(\d+)\/#token=([a-z0-9]+)$/m
/** A cold Node start on a busy runner, with room to spare. */
const READY_MS = 8_000

export interface Daemon {
  /** `http://127.0.0.1:<port>`, with no token. */
  readonly origin: string
  /** The link the daemon prints, token and all. */
  readonly link: string
  readonly stop: () => Promise<void>
}

export function startDaemon(): Promise<Daemon> {
  if (!existsSync(BIN)) {
    return Promise.reject(new Error(`${BIN} is missing. Run \`pnpm run build\` first.`))
  }
  // No inherited key: a developer's own must never reach a test's child.
  const { VERIFAI_API_KEY: _key, ...env } = process.env
  const child = spawn(
    process.execPath,
    [BIN, 'web', '--no-open', '--allow-private-targets', '--port', '0'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
    }
    await closed
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const fail = (reason: string) => {
      clearTimeout(timer)
      void stop()
      reject(new Error(`verifai web ${reason}. Its stderr: ${stderr.trim() || '(empty)'}`))
    }
    const timer = setTimeout(() => fail(`printed no link within ${READY_MS} ms`), READY_MS)
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      const match = DAEMON_LINK.exec(stdout)
      if (match !== null) {
        clearTimeout(timer)
        resolve({ origin: `http://127.0.0.1:${match[1]}`, link: match[0], stop })
      }
    })
    child.once('error', (error) => fail(`did not start: ${error.message}`))
    child.once('exit', (code) => fail(`exited with ${code} before it was ready`))
  })
}
