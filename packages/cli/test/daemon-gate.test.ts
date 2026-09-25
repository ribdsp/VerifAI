import { describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES } from '../src/daemon/body.js'
import { isSameOrigin, localHost } from '../src/daemon/guard.js'
import { CONTENT_SECURITY_POLICY } from '../src/daemon/respond.js'
import { DaemonStartError, startDaemon } from '../src/daemon/server.js'
import { KEY } from './support/context.js'
import { ASSETS, daemon, PAGE, SCRIPT_PATH } from './support/daemon.js'
import { type ApiResponse, api, bearer, errorCode, errorMessage, raw } from './support/http.js'

const NAVIGATION = Object.freeze({
  'sec-fetch-site': 'cross-site',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
})

function asApi(response: { status: number; headers: ApiResponse['headers']; body: string }) {
  return { ...response, json: JSON.parse(response.body) as unknown }
}

describe('the daemon’s listener', () => {
  it('listens on loopback only and prints a link with the token after the #', async () => {
    const d = await daemon()
    expect(d.origin).toBe(`http://127.0.0.1:${d.port}`)
    expect(d.url).toBe(`${d.origin}/#token=${d.token}`)
    expect(d.token).toMatch(/^[a-z0-9]{48}$/)
  })

  it('draws a fresh token for every process', async () => {
    const [first, second] = await Promise.all([daemon(), daemon()])
    expect(first.token).not.toBe(second.token)
  })

  it('says so plainly when the port is taken', async () => {
    const taken = await daemon()
    const second = startDaemon({
      port: taken.port,
      assets: ASSETS,
      allowPrivateTargets: false,
      createTransport: () => ({ send: async () => Promise.reject(new Error('unused')) }),
      version: '0.0.0',
    })
    await expect(second).rejects.toBeInstanceOf(DaemonStartError)
    await expect(second).rejects.toThrow(`Port ${taken.port} is already in use.`)
  })

  it('stops answering once closed', async () => {
    const d = await daemon()
    await d.close()
    await expect(raw(d.port)).rejects.toThrow()
  })
})

describe('the page', () => {
  it('serves the page and its assets with the security headers, token or not', async () => {
    const d = await daemon()
    const page = await raw(d.port, { path: '/' })
    expect(page.status).toBe(200)
    expect(page.body).toBe(PAGE)
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(page.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
    expect(page.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    })
    expect(page.headers['access-control-allow-origin']).toBeUndefined()

    const script = await raw(d.port, { path: SCRIPT_PATH })
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect((await raw(d.port, { path: '/index.html' })).body).toBe(PAGE)
  })

  it('answers HEAD with the length and no body', async () => {
    const d = await daemon()
    const head = await raw(d.port, { method: 'HEAD', path: '/' })
    expect(head.status).toBe(200)
    expect(head.headers['content-length']).toBe(String(PAGE.length))
    expect(head.body).toBe('')
  })

  it('has nothing else, and takes only GET and HEAD', async () => {
    const d = await daemon()
    // A dot segment is resolved before the lookup, so it can only land on a served path.
    expect((await raw(d.port, { path: '/assets/../index.html' })).body).toBe(PAGE)
    expect((await raw(d.port, { path: '/assets/../../etc/passwd' })).status).toBe(404)
    expect((await raw(d.port, { path: '/assets/%2e%2e%2findex.html' })).status).toBe(404)
    expect((await raw(d.port, { path: '/favicon.ico' })).status).toBe(404)
    const post = await raw(d.port, { method: 'POST', path: '/' })
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')
  })

  it('opens from a link on another site, which is a plain navigation', async () => {
    const d = await daemon()
    expect((await raw(d.port, { path: '/', headers: NAVIGATION })).status).toBe(200)
  })
})

describe('the gate', () => {
  it('refuses a request target that is not a path on this server', async () => {
    const d = await daemon()
    expect((await raw(d.port, { path: '//evil.example/api/health' })).status).toBe(400)
    expect((await raw(d.port, { path: 'http://evil.example/' })).status).toBe(400)
  })

  it('answers only to its own Host, which stops DNS rebinding', async () => {
    const d = await daemon()
    const host = (value: string) => raw(d.port, { path: '/', headers: { host: value } })
    expect((await host('evil.example')).status).toBe(403)
    expect((await host(`evil.example:${d.port}`)).status).toBe(403)
    expect((await host(`127.0.0.1:${d.port + 1}`)).status).toBe(403)
    expect((await host(`localhost:${d.port}`)).status).toBe(200)
    expect((await host(`LOCALHOST:${d.port}`)).status).toBe(200)
  })

  it('takes a Host without its port on port 80, where a browser leaves the port out', () => {
    // Port 80 needs privileges a test does not have, so the rule is checked on its own.
    expect(localHost({ host: '127.0.0.1' }, 80)).toBe('127.0.0.1')
    expect(localHost({ host: 'LOCALHOST' }, 80)).toBe('localhost')
    expect(localHost({ host: '127.0.0.1:80' }, 80)).toBe('127.0.0.1:80')
    expect(localHost({ host: 'evil.example' }, 80)).toBeUndefined()
    expect(localHost({ host: '127.0.0.1' }, 8080)).toBeUndefined()
    expect(isSameOrigin({ origin: 'http://127.0.0.1' }, '127.0.0.1')).toBe(true)
  })

  it('refuses the API to a request another site made, before the token is looked at', async () => {
    const d = await daemon()
    const call = (headers: Record<string, string>) =>
      raw(d.port, { path: '/api/health', headers: { ...bearer(d), ...headers } })
    expect((await call({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await call({ origin: 'null' })).status).toBe(403)
    expect((await call({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await call({ 'sec-fetch-site': 'same-site' })).status).toBe(403)
    expect((await call(NAVIGATION)).status).toBe(403)
    expect((await call({ origin: d.origin, 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })

  it('lets a refused cross-site flood cost the page nothing', async () => {
    const d = await daemon({ limits: { requestsPerMinute: 1, authFailuresPerMinute: 1 } })
    for (let index = 0; index < 5; index += 1) {
      await raw(d.port, { path: '/api/health', headers: { origin: 'https://evil.example' } })
    }
    expect((await api(d, 'GET', '/api/health')).status).toBe(200)
  })

  it('limits the whole process’s traffic, saying when to retry', async () => {
    const d = await daemon({ limits: { requestsPerMinute: 2, authFailuresPerMinute: 30 } })
    await raw(d.port, { path: '/' })
    await api(d, 'GET', '/api/health')
    const limited = await raw(d.port, { path: '/' })
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toMatch(/^\d+$/)
    expect(errorCode(asApi(limited))).toBe('rate-limited')
  })
})

describe('the session token', () => {
  it('is needed for the API, with a Bearer challenge', async () => {
    const d = await daemon()
    const missing = await raw(d.port, { path: '/api/health' })
    expect(missing.status).toBe(401)
    expect(missing.headers['www-authenticate']).toBe('Bearer')
    expect(errorCode(asApi(missing))).toBe('unauthorized')
  })

  it.each([
    ['a wrong token', (token: string) => `Bearer ${'x'.repeat(token.length)}`],
    ['the token with more after it', (token: string) => `Bearer ${token}x`],
    ['the token cut short', (token: string) => `Bearer ${token.slice(1)}`],
    ['another scheme', (token: string) => `Basic ${token}`],
    ['a lower-case scheme', (token: string) => `bearer ${token}`],
    ['two spaces after the scheme', (token: string) => `Bearer  ${token}`],
    ['a token of other characters', (token: string) => `Bearer ${token.slice(1)}-`],
  ])('refuses %s', async (_name, header) => {
    const d = await daemon()
    const response = await raw(d.port, {
      path: '/api/health',
      headers: { authorization: header(d.token) },
    })
    expect(response.status).toBe(401)
  })

  it('stops taking guesses once too many were wrong, even the right one', async () => {
    const d = await daemon({ limits: { requestsPerMinute: 100, authFailuresPerMinute: 2 } })
    const guess = () =>
      raw(d.port, { path: '/api/health', headers: { authorization: 'Bearer wrong' } })
    expect((await guess()).status).toBe(401)
    expect((await guess()).status).toBe(401)
    expect((await guess()).status).toBe(429)
    const right = await api(d, 'GET', '/api/health')
    expect(right.status).toBe(429)
    expect(right.headers['retry-after']).toMatch(/^\d+$/)
  })
})

describe('the API’s surface', () => {
  it('reports its health and version', async () => {
    const d = await daemon()
    const health = await api(d, 'GET', '/api/health')
    expect(health.status).toBe(200)
    expect(health.json).toEqual({ ok: true, version: '0.0.0' })
    expect(health.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(health.headers['cache-control']).toBe('no-store')
  })

  it('offers the choices core accepts', async () => {
    const d = await daemon()
    const options = (await api(d, 'GET', '/api/options')).json as {
      profiles: { profile: string }[]
      defaults: unknown
    }
    expect(options.profiles.map((entry) => entry.profile)).toEqual([
      'quick',
      'standard',
      'deep',
      'paranoid',
    ])
    expect(options.defaults).toEqual({
      profile: 'standard',
      vendor: 'auto',
      protocol: 'auto',
      auth: 'auto',
    })
  })

  it.each([
    '/api',
    '/api/nope',
    '/api/checks/UPPERCASE',
    '/api/checks/abc/report/extra',
    '/api/checks/abc/nope',
    `/api/checks/${'a'.repeat(65)}`,
  ])('has no %s', async (path) => {
    const d = await daemon()
    const response = await api(d, 'GET', path)
    expect(response.status).toBe(404)
    expect(errorCode(response)).toBe('not-found')
  })

  it('names the methods a path takes', async () => {
    const d = await daemon()
    const wrong = await api(d, 'DELETE', '/api/health')
    expect(wrong.status).toBe(405)
    expect(wrong.headers.allow).toBe('GET')
    expect((await api(d, 'GET', '/api/checks')).headers.allow).toBe('POST')
    expect((await api(d, 'PUT', '/api/checks/abc')).headers.allow).toBe('GET, DELETE')
  })
})

describe('a request body', () => {
  const post = (port: number, token: string, options: Parameters<typeof raw>[1]) =>
    raw(port, {
      method: 'POST',
      path: '/api/checks',
      ...options,
      headers: { authorization: `Bearer ${token}`, ...options?.headers },
    })

  it('must be declared as JSON', async () => {
    const d = await daemon()
    const plain = await post(d.port, d.token, {
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    })
    expect(plain.status).toBe(415)
    const missing = await post(d.port, d.token, { body: '{}' })
    expect(missing.status).toBe(415)
  })

  it('is refused unread when it declares more than the limit', async () => {
    const d = await daemon()
    const response = await post(d.port, d.token, {
      headers: {
        'content-type': 'application/json',
        'content-length': String(MAX_BODY_BYTES + 1),
      },
      body: '{}',
    })
    expect(response.status).toBe(413)
    expect(response.headers.connection).toBe('close')
  })

  it('is cut off the moment an undeclared one passes the limit', async () => {
    const d = await daemon()
    const chunk = new Uint8Array(16 * 1024).fill(0x20)
    const response = await post(d.port, d.token, {
      headers: { 'content-type': 'application/json' },
      chunks: Array.from({ length: 8 }, () => chunk),
    })
    expect(response.status).toBe(413)
    expect(response.headers.connection).toBe('close')
  })

  it('must be UTF-8 and JSON', async () => {
    const d = await daemon()
    const json = { 'content-type': 'application/json; charset=utf-8' }
    const bytes = await post(d.port, d.token, {
      headers: json,
      body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
    })
    expect(bytes.status).toBe(400)
    expect(errorMessage(asApi(bytes))).toBe('The body is not readable UTF-8.')

    const text = await post(d.port, d.token, { headers: json, body: '{"endpoint":' })
    expect(text.status).toBe(400)
    expect(errorMessage(asApi(text))).toBe('The body is not valid JSON.')
  })

  it('names the fields it refuses, and never repeats what was sent', async () => {
    const d = await daemon()
    const response = await api(d, 'POST', '/api/checks', {
      endpoint: 'https://gateway.example/v1',
      apiKey: KEY,
      model: '',
      colour: KEY,
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('invalid-request')
    expect(errorMessage(response)).toMatch(/model/)
    expect(response.body).not.toContain(KEY)
  })
})
