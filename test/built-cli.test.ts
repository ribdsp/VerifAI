import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The built `verifai` binary, run as a buyer would run it.
 *
 * Everything else tests `main` against a fake world; this is the one place the
 * real wiring in `bin.ts` runs - the Node transport, the signal handling, the
 * web UI copied next to `bin.js`. It runs only when `VERIFAI_REQUIRE_BUILD` is
 * set, as CI sets it after `pnpm run build`: a local `dist/` may be older than
 * the source, and a stale build failing the unit suite would point at nothing.
 * To run it locally: `pnpm run build`, then
 * `VERIFAI_REQUIRE_BUILD=1 pnpm exec vitest run test/built-cli.test.ts`.
 */

const BIN = fileURLToPath(new URL('../packages/cli/dist/bin.js', import.meta.url))
const WEB_INDEX = fileURLToPath(new URL('../packages/cli/dist/web/index.html', import.meta.url))
const MANIFEST = new URL('../packages/cli/package.json', import.meta.url)

const mustRun = (process.env.VERIFAI_REQUIRE_BUILD ?? '') !== ''
const DAEMON_LINK = /^http:\/\/127\.0\.0\.1:(\d+)\/#token=([a-z0-9]+)$/m
/** A cold Node start on a busy runner, with room to spare. */
const READY_MS = 8_000

interface Finished {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

const children: ChildProcess[] = []

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill()
  }
})

function start(args: readonly string[]) {
  // No inherited key: a developer's own must never reach a test's child.
  const { VERIFAI_API_KEY: _key, ...env } = process.env
  const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const finished = new Promise<Finished>((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  return { child, finished, stdout: () => stdout, stderr: () => stderr }
}

function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const outgoing = request(
        { host: '127.0.0.1', port, path, headers, agent: false },
        (incoming) => {
          let body = ''
          incoming.on('data', (chunk: Buffer) => {
            body += chunk.toString('utf8')
          })
          incoming.on('end', () =>
            resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }),
          )
        },
      )
      outgoing.on('error', reject)
      outgoing.end()
    },
  )
}

describe.runIf(mustRun)('the built verifai binary', () => {
  it('is built, with the web UI next to it', () => {
    expect(existsSync(BIN)).toBe(true)
    expect(existsSync(WEB_INDEX)).toBe(true)
  })

  it('prints the package’s version', async () => {
    const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')) as { version: string }
    const run = await start(['--version']).finished
    expect(run).toEqual({ code: 0, stdout: `${manifest.version}\n`, stderr: '' })
  })

  it('prints the help and exits 2 when no one is at a terminal', async () => {
    const run = await start([]).finished
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('Usage:')
    expect(run.stdout).toBe('')
  })

  it('refuses the key as a flag without sending anything', async () => {
    const run = await start(['check', '--api-key', 'x']).finished
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('does not take the API key as a flag')
  })

  it('serves the web UI on loopback and answers its own page with the token', async () => {
    const web = start(['web', '--no-open', '--port', '0'])
    let link: RegExpExecArray | null = null
    const deadline = Date.now() + READY_MS
    while (link === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      link = DAEMON_LINK.exec(web.stdout())
    }
    if (link === null) {
      throw new Error(`verifai web did not print its link: ${web.stderr()}`)
    }
    const port = Number(link[1])
    const token = link[2] ?? ''
    expect(web.stderr()).not.toContain(token)

    const page = await get(port, '/')
    expect(page.status).toBe(200)
    expect(page.body).toMatch(/^<!doctype html>/i)
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'")

    expect((await get(port, '/api/health')).status).toBe(401)
    const health = await get(port, '/api/health', { authorization: `Bearer ${token}` })
    expect(JSON.parse(health.body)).toMatchObject({ ok: true })

    // Windows has no SIGINT to send another process; there the kill is the stop.
    if (process.platform !== 'win32') {
      web.child.kill('SIGINT')
      const run = await web.finished
      expect(run.code).toBe(0)
      expect(run.stderr).toContain('Stopped. Every check this page held, and its key, is gone.')
    }
  })
})
