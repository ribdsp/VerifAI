import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEBUG_ENV } from '../src/check/command.js'
import { EXIT_CODES, type ExitCode } from '../src/exit-codes.js'
import { WEB_HELP } from '../src/help.js'
import { main } from '../src/main.js'
import { parseWebFlags } from '../src/web/command.js'
import { KEY, type TestContext, testContext } from './support/context.js'
import { raw } from './support/http.js'

const PAGE = '<!doctype html><title>VerifAI</title>'
const READY = 'Press Ctrl+C to stop.'
/** How long `verifai web` may take to say it is serving, however slow the runner. */
const READY_MS = 4_000

let webRoot = ''

beforeAll(async () => {
  webRoot = await mkdtemp(join(tmpdir(), 'verifai-web-'))
  await mkdir(join(webRoot, 'assets'))
  await writeFile(join(webRoot, 'index.html'), PAGE)
  await writeFile(join(webRoot, 'assets', 'index-abc123.js'), 'export {}')
})

afterAll(async () => {
  await rm(webRoot, { recursive: true, force: true })
})

interface Serving {
  readonly exit: Promise<ExitCode>
  readonly url: string
  readonly port: number
  readonly token: string
}

/** Starts `verifai web` and waits until it says it is serving. */
async function serve(t: TestContext, args: readonly string[] = ['--no-open']): Promise<Serving> {
  const exit = main(['web', ...args], t.context)
  const deadline = Date.now() + READY_MS
  while (Date.now() < deadline && !t.stderr.text().includes(READY)) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const url = t.stdout.text().trim()
  const match = /^http:\/\/127\.0\.0\.1:(\d+)\/#token=([a-z0-9]+)$/.exec(url)
  if (match === null) {
    t.abort()
    throw new Error(`Not serving: ${t.stderr.text()}`)
  }
  return { exit, url, port: Number(match[1]), token: match[2] ?? '' }
}

function postCheck(serving: Serving, body: object) {
  return raw(serving.port, {
    method: 'POST',
    path: '/api/checks',
    headers: { authorization: `Bearer ${serving.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const CHECK = Object.freeze({
  endpoint: 'https://gateway.example/v1',
  apiKey: KEY,
  model: 'claude-opus-5-5',
  vendor: 'anthropic',
  protocol: 'anthropic-messages',
  profile: 'quick',
})

const PRIVATE_CHECK = Object.freeze({
  ...CHECK,
  endpoint: 'http://127.0.0.1:9/v1',
  allowPrivateTargets: true,
})

describe('parseWebFlags', () => {
  it('defaults to a free port, opening the browser, public targets only', () => {
    expect(parseWebFlags([])).toEqual({
      port: 0,
      open: true,
      allowPrivateTargets: false,
      help: false,
    })
  })

  it('takes a port, --no-open and --allow-private-targets', () => {
    expect(parseWebFlags(['--port', '8080', '--no-open', '--allow-private-targets'])).toEqual({
      port: 8080,
      open: false,
      allowPrivateTargets: true,
      help: false,
    })
    expect(parseWebFlags(['--port=65535']).port).toBe(65_535)
  })

  it.each(['65536', '123456', '8o80', '', '1e3', ' 80'])('refuses the port %j', (port) => {
    expect(() => parseWebFlags(['--port', port])).toThrow(
      '--port takes a whole number from 0 to 65535.',
    )
  })

  it('refuses a flag it does not take, and a stray argument', () => {
    expect(() => parseWebFlags(['--endpoint', 'https://gateway.example/v1'])).toThrow()
    expect(() => parseWebFlags(['now'])).toThrow()
  })
})

describe('verifai web', () => {
  it('prints its help', async () => {
    const t = testContext()
    expect(await main(['web', '--help'], t.context)).toBe(EXIT_CODES.pass)
    expect(t.stdout.text()).toBe(WEB_HELP)
  })

  it('says so when the web UI is not built, and serves nothing', async () => {
    const t = testContext({ webRoot: join(webRoot, 'nowhere') })
    expect(await main(['web'], t.context)).toBe(EXIT_CODES.internal)
    expect(t.stderr.text()).toContain('The web UI is not part of this install.')
    expect(t.stdout.text()).toBe('')
    expect(t.opened).toEqual([])
  })

  it('serves the page, prints the link on stdout only, and stops on Ctrl+C', async () => {
    const t = testContext({ webRoot })
    const serving = await serve(t)
    expect(t.stderr.text()).toContain('VerifAI 0.0.0 is serving its web UI on http://127.0.0.1:')
    expect(t.stderr.text()).not.toContain(serving.token)
    expect(t.opened).toEqual([])

    expect((await raw(serving.port, { path: '/' })).body).toBe(PAGE)
    expect((await raw(serving.port, { path: '/assets/index-abc123.js' })).status).toBe(200)

    t.abort()
    expect(await serving.exit).toBe(EXIT_CODES.pass)
    expect(t.stderr.text()).toMatch(
      /Stopped\. Every check this page held, and its key, is gone\.\n$/,
    )
    await expect(raw(serving.port)).rejects.toThrow()
  })

  it('opens the link in a browser unless told not to', async () => {
    const t = testContext({ webRoot })
    const serving = await serve(t, [])
    expect(t.opened).toEqual([serving.url])
    expect(t.stderr.text()).not.toContain('Could not open a browser')
    t.abort()
    await serving.exit
  })

  it('says to copy the link when no browser opens', async () => {
    const t = testContext({ webRoot, opens: false })
    const serving = await serve(t, [])
    expect(t.stderr.text()).toContain('Could not open a browser. Copy the link above into one.')
    t.abort()
    expect(await serving.exit).toBe(EXIT_CODES.pass)
  })

  it('refuses private endpoints unless started to allow them', async () => {
    const t = testContext({ webRoot })
    const serving = await serve(t)
    expect((await postCheck(serving, PRIVATE_CHECK)).status).toBe(403)
    expect(t.stderr.text()).not.toContain('Private addresses may be checked')
    t.abort()
    await serving.exit
  })

  it('checks a private endpoint when started to allow them, and says so', async () => {
    const t = testContext({ webRoot })
    const serving = await serve(t, ['--no-open', '--allow-private-targets'])
    expect(t.stderr.text()).toContain(
      'Private addresses may be checked from this page, until it stops.',
    )
    expect((await postCheck(serving, PRIVATE_CHECK)).status).toBe(201)
    expect(t.transports).toEqual([true])
    t.abort()
    await serving.exit
  })

  it('says plainly when its port is taken', async () => {
    const taken: Server = createServer()
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve))
    const address = taken.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    try {
      const t = testContext({ webRoot })
      expect(await main(['web', '--port', String(port), '--no-open'], t.context)).toBe(
        EXIT_CODES.internal,
      )
      expect(t.stderr.text()).toContain(`Port ${port} is already in use.`)
      expect(t.stdout.text()).toBe('')
    } finally {
      await new Promise((resolve) => taken.close(resolve))
    }
  })

  it(`prints what failed inside, by name only, under ${DEBUG_ENV}`, async () => {
    const t = testContext({ webRoot, env: { [DEBUG_ENV]: '1' } })
    const context = {
      ...t.context,
      createTransport: () => {
        throw new RangeError(`broken near ${KEY}`)
      },
    }
    const serving = await serve({ ...t, context })
    expect((await postCheck(serving, CHECK)).status).toBe(500)
    expect(t.stderr.text()).toContain('request failed: RangeError')
    expect(t.stderr.text()).not.toContain(KEY)
    t.abort()
    await serving.exit
  })

  it('logs nothing of a failure without it', async () => {
    const t = testContext({ webRoot })
    const context = {
      ...t.context,
      createTransport: () => {
        throw new RangeError('broken')
      },
    }
    const serving = await serve({ ...t, context })
    expect((await postCheck(serving, CHECK)).status).toBe(500)
    expect(t.stderr.text()).not.toContain('RangeError')
    t.abort()
    await serving.exit
  })
})
