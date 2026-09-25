import http from 'node:http'
import type { AddressInfo } from 'node:net'
import net from 'node:net'
import zlib from 'node:zlib'
import type { TransportFailure, TransportRequest, TransportResult } from '@verifai/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Resolver } from '../src/resolver.js'
import { createNodeTransport } from '../src/transport.js'

/*
 * Every test here talks to a real server on loopback, reached through the
 * hostname `localhost` and an injected resolver. The no-network guard judges a
 * connection by the host it is aimed at, so a made-up public name would be
 * refused before the pinned lookup ever ran.
 */

const LOOPBACK: Resolver = async () => ['127.0.0.1']

const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

function listen(server: http.Server | net.Server): Promise<number> {
  closers.push(
    () =>
      new Promise((resolve) => {
        if ('closeAllConnections' in server) {
          server.closeAllConnections()
        }
        server.close(() => resolve())
      }),
  )
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

interface Seen {
  readonly rawHeaders: readonly string[]
  readonly method: string | undefined
  readonly url: string | undefined
  readonly body: Buffer
}

async function serve(
  respond: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ readonly port: number; readonly seen: Seen[] }> {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    const parts: Buffer[] = []
    req.on('data', (part: Buffer) => parts.push(part))
    req.on('end', () => {
      seen.push({
        rawHeaders: req.rawHeaders,
        method: req.method,
        url: req.url,
        body: Buffer.concat(parts),
      })
      respond(req, res)
    })
  })
  return { port: await listen(server), seen }
}

/** A server that answers with bytes of its own choosing, HTTP or not. */
async function serveRaw(onConnection: (socket: net.Socket) => void): Promise<number> {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    onConnection(socket)
  })
  closers.push(async () => {
    for (const socket of sockets) {
      socket.destroy()
    }
  })
  return listen(server)
}

/** A port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = net.createServer()
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

function get(url: string, extra: Partial<TransportRequest> = {}): TransportRequest {
  return { method: 'GET', url, headers: [], ...extra }
}

function expectFailure(result: TransportResult): TransportFailure {
  if (result.ok) {
    throw new Error(`Expected a failure, got HTTP ${result.status}`)
  }
  return result
}

function expectResponse(result: TransportResult) {
  if (!result.ok) {
    throw new Error(`Expected a response, got ${result.kind}`)
  }
  return result
}

const text = (body: Uint8Array) => Buffer.from(body).toString('utf8')

describe('the request on the wire', () => {
  it('sends headers in the order and casing the probe wrote, after the Host it pinned', async () => {
    const { port, seen } = await serve((_req, res) => res.end())
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    await transport.send({
      method: 'POST',
      url: `http://localhost:${port}/v1/messages?beta=true#fragment`,
      headers: [
        ['x-api-key', 'test-key'],
        ['anthropic-version', '2023-06-01'],
        ['X-Dup', 'a'],
        ['x-dup', 'b'],
      ],
      body: new TextEncoder().encode('{"a": 1}'),
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.url).toBe('/v1/messages?beta=true')
    expect(seen[0]?.rawHeaders).toEqual([
      'Host',
      `localhost:${port}`,
      'x-api-key',
      'test-key',
      'anthropic-version',
      '2023-06-01',
      'X-Dup',
      'a',
      'x-dup',
      'b',
      'Content-Length',
      '8',
      'Connection',
      'close',
    ])
    expect(seen[0]?.body.toString('utf8')).toBe('{"a": 1}')
  })

  it('frames a bodiless POST with an explicit zero length rather than chunking', async () => {
    const { port, seen } = await serve((_req, res) => res.end())
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    await transport.send({ method: 'POST', url: `http://localhost:${port}/`, headers: [] })

    expect(seen[0]?.rawHeaders).toEqual([
      'Host',
      `localhost:${port}`,
      'Content-Length',
      '0',
      'Connection',
      'close',
    ])
  })

  it('adds nothing to a GET beyond Host and Connection', async () => {
    const { port, seen } = await serve((_req, res) => res.end())
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    await transport.send(get(`http://localhost:${port}/v1/models`))

    expect(seen[0]?.rawHeaders).toEqual(['Host', `localhost:${port}`, 'Connection', 'close'])
  })

  it("names itself in the User-Agent it was given, after the probe's own headers", async () => {
    const { port, seen } = await serve((_req, res) => res.end())
    const transport = createNodeTransport({
      allowPrivateTargets: true,
      resolver: LOOPBACK,
      userAgent: 'verifai/1.2.3',
    })

    await transport.send(get(`http://localhost:${port}/`, { headers: [['Accept', 'text/plain']] }))

    expect(seen[0]?.rawHeaders).toEqual([
      'Host',
      `localhost:${port}`,
      'Accept',
      'text/plain',
      'User-Agent',
      'verifai/1.2.3',
      'Connection',
      'close',
    ])
  })

  it('leaves a User-Agent the probe wrote as the only one', async () => {
    const { port, seen } = await serve((_req, res) => res.end())
    const transport = createNodeTransport({
      allowPrivateTargets: true,
      resolver: LOOPBACK,
      userAgent: 'verifai/1.2.3',
    })

    await transport.send(get(`http://localhost:${port}/`, { headers: [['user-agent', 'probe/0']] }))

    expect(seen[0]?.rawHeaders).toEqual([
      'Host',
      `localhost:${port}`,
      'user-agent',
      'probe/0',
      'Connection',
      'close',
    ])
  })

  it('refuses a User-Agent that could not be sent before sending anything', () => {
    for (const userAgent of ['a\r\nb', '']) {
      expect(() => createNodeTransport({ allowPrivateTargets: false, userAgent })).toThrow(
        TypeError,
      )
    }
  })

  it('connects to an address literal without consulting the resolver', async () => {
    const { port, seen } = await serve((_req, res) => res.end('ok'))
    const resolver = vi.fn(LOOPBACK)
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver })

    const response = expectResponse(await transport.send(get(`http://127.0.0.1:${port}/`)))

    expect(resolver).not.toHaveBeenCalled()
    expect(text(response.body)).toBe('ok')
    expect(seen[0]?.rawHeaders.slice(0, 2)).toEqual(['Host', `127.0.0.1:${port}`])
  })
})

describe('the response as it came off the wire', () => {
  it('keeps status text, header casing, header order and repeated headers', async () => {
    const { port } = await serve((_req, res) => {
      res.writeHead(201, 'Created By A Proxy', [
        'Content-Type',
        'application/json',
        'X-Dup',
        'a',
        'x-dup',
        'b',
        'Access-Control-Expose-Headers',
        'CF-Ray',
        'Access-Control-Expose-Headers',
        'CF-Ray',
      ])
      res.end('{\n  "a": 1\n}')
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const response = expectResponse(await transport.send(get(`http://localhost:${port}/`)))

    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created By A Proxy')
    expect(response.httpVersion).toBe('1.1')
    expect(response.headers.slice(0, 5)).toEqual([
      ['Content-Type', 'application/json'],
      ['X-Dup', 'a'],
      ['x-dup', 'b'],
      ['Access-Control-Expose-Headers', 'CF-Ray'],
      ['Access-Control-Expose-Headers', 'CF-Ray'],
    ])
    expect(text(response.body)).toBe('{\n  "a": 1\n}')
    expect(response.connection).toBe('fresh')
    expect(Object.isFrozen(response)).toBe(true)
  })

  it('records when each piece of the body arrived', async () => {
    const { port } = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: 1\n\n')
      setTimeout(() => res.end('data: 2\n\n'), 60)
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const response = expectResponse(await transport.send(get(`http://localhost:${port}/`)))

    expect(text(response.body)).toBe('data: 1\n\ndata: 2\n\n')
    expect(response.chunks.length).toBeGreaterThanOrEqual(2)
    expect(response.chunks[0]?.start).toBe(0)
    expect(response.chunks.at(-1)?.end).toBe(response.body.length)
    for (const [at, chunk] of response.chunks.entries()) {
      const previous = response.chunks[at - 1]
      if (previous !== undefined) {
        expect(chunk.start).toBe(previous.end)
        expect(chunk.atMs).toBeGreaterThanOrEqual(previous.atMs)
      }
    }
    const { startedMs, headersMs, completedMs } = response.timing
    expect(startedMs).toBeLessThanOrEqual(headersMs)
    expect(headersMs).toBeLessThanOrEqual(response.chunks[0]?.atMs ?? Number.NaN)
    expect(response.chunks.at(-1)?.atMs).toBeLessThanOrEqual(completedMs)
    expect(completedMs - headersMs).toBeGreaterThanOrEqual(40)
  })

  it('reads every duration from the injected clock', async () => {
    const { port } = await serve((_req, res) => res.end('ok'))
    let now = 1000
    const clock = () => {
      now += 1
      return now
    }
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK, clock })

    const response = expectResponse(await transport.send(get(`http://localhost:${port}/`)))

    expect(response.timing.startedMs).toBeGreaterThan(1000)
    expect(response.timing.completedMs).toBeLessThanOrEqual(now)
  })

  it('hands back a redirect instead of following it', async () => {
    const { port, seen } = await serve((_req, res) => {
      res.writeHead(302, ['Location', 'http://169.254.169.254/latest/meta-data/'])
      res.end()
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const response = expectResponse(await transport.send(get(`http://localhost:${port}/`)))

    expect(response.status).toBe(302)
    expect(seen).toHaveLength(1)
  })

  it('decodes a compressed body and leaves the encoding header as sent', async () => {
    const { port } = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.end(zlib.gzipSync('{"compressed": true}'))
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const response = expectResponse(await transport.send(get(`http://localhost:${port}/`)))

    expect(text(response.body)).toBe('{"compressed": true}')
    expect(response.headers).toContainEqual(['Content-Encoding', 'gzip'])
    expect(response.chunks.at(-1)?.end).toBe(response.body.length)
  })

  it.each([
    ['deflate', zlib.deflateSync],
    ['br', zlib.brotliCompressSync],
    ['x-gzip', zlib.gzipSync],
    ['identity', (input: string) => Buffer.from(input)],
  ] as const)('decodes %s', async (encoding, encode) => {
    const { port } = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': encoding })
      res.end(encode('same bytes'))
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const response = expectResponse(await transport.send(get(`http://localhost:${port}/`)))

    expect(text(response.body)).toBe('same bytes')
  })

  it('returns an empty body for HEAD', async () => {
    const { port } = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Length': '1234' })
      res.end()
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const response = expectResponse(
      await transport.send({ method: 'HEAD', url: `http://localhost:${port}/`, headers: [] }),
    )

    expect(response.body.length).toBe(0)
    expect(response.headers).toContainEqual(['Content-Length', '1234'])
  })
})

describe('the guard in front of the socket', () => {
  it('refuses a name that resolves into cloud metadata, even with private targets allowed', async () => {
    const transport = createNodeTransport({
      allowPrivateTargets: true,
      resolver: async () => ['169.254.169.254'],
    })

    const failure = expectFailure(await transport.send(get('https://api.example.com/v1/models')))

    expect(failure).toMatchObject({
      kind: 'blocked-target',
      blockedScope: 'forbidden',
      sent: false,
      connection: 'unobserved',
    })
  })

  it('refuses a private address unless the run allows private targets', async () => {
    const transport = createNodeTransport({
      allowPrivateTargets: false,
      resolver: async () => ['10.1.2.3'],
    })

    const failure = expectFailure(await transport.send(get('https://api.example.com/')))

    expect(failure).toMatchObject({ kind: 'blocked-target', blockedScope: 'private' })
  })

  it('refuses the whole set when any one resolved address is refused', async () => {
    const transport = createNodeTransport({
      allowPrivateTargets: false,
      resolver: async () => ['104.18.6.192', '127.0.0.1'],
    })

    const failure = expectFailure(await transport.send(get('https://api.example.com/')))

    expect(failure).toMatchObject({ kind: 'blocked-target', blockedScope: 'private' })
  })

  it('refuses an address literal before resolving or connecting anything', async () => {
    const resolver = vi.fn(LOOPBACK)
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver })

    for (const url of [
      'http://169.254.169.254/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://0.0.0.0/',
    ]) {
      const failure = expectFailure(await transport.send(get(url)))
      expect(failure, url).toMatchObject({ kind: 'blocked-target', blockedScope: 'forbidden' })
    }
    expect(resolver).not.toHaveBeenCalled()
  })

  it('refuses a resolver answer that is not an address', async () => {
    const transport = createNodeTransport({
      allowPrivateTargets: true,
      resolver: async () => ['localhost'],
    })

    const failure = expectFailure(await transport.send(get('https://api.example.com/')))

    expect(failure).toMatchObject({ kind: 'blocked-target', blockedScope: 'forbidden' })
  })
})

describe('failures collapse to the fixed taxonomy', () => {
  function expectOpaque(failure: TransportFailure, ...forbidden: string[]) {
    // A message that carried an errno, an address or a port would let whoever
    // drives VerifAI map a network through it.
    for (const fragment of ['ECONN', 'ENOTFOUND', 'EAI_', '127.0.0.1', ...forbidden]) {
      expect(failure.message).not.toContain(fragment)
    }
    expect(Object.isFrozen(failure)).toBe(true)
  }

  it('reports a resolver error as a DNS failure, without its detail', async () => {
    const transport = createNodeTransport({
      allowPrivateTargets: true,
      resolver: async () => {
        throw new Error('getaddrinfo ENOTFOUND internal.corp.example')
      },
    })

    const failure = expectFailure(await transport.send(get('https://internal.corp.example/')))

    expect(failure).toMatchObject({ kind: 'dns-failure', sent: false, connection: 'unobserved' })
    expectOpaque(failure, 'internal.corp')
  })

  it('reports a resolver that throws synchronously, or answers nothing, as a DNS failure', async () => {
    const throwing: Resolver = () => {
      throw new Error('boom')
    }
    for (const resolver of [throwing, async () => []]) {
      const transport = createNodeTransport({ allowPrivateTargets: true, resolver })
      const failure = expectFailure(await transport.send(get('https://api.example.com/')))
      expect(failure.kind).toBe('dns-failure')
    }
  })

  it('reports a refused connection without the port it was refused on', async () => {
    const port = await closedPort()
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(await transport.send(get(`http://localhost:${port}/`)))

    expect(failure).toMatchObject({
      kind: 'connection-failed',
      sent: false,
      connection: 'unobserved',
    })
    expectOpaque(failure, String(port))
  })

  it('reports a failed handshake as a TLS failure on a connection that did open', async () => {
    const { port } = await serve((_req, res) => res.end('plain http'))
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(await transport.send(get(`https://localhost:${port}/`)))

    expect(failure).toMatchObject({ kind: 'tls-failure', sent: false, connection: 'fresh' })
    expectOpaque(failure, String(port))
  })

  it('times out an endpoint that accepts the request and never answers', async () => {
    const port = await serveRaw(() => {})
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(
      await transport.send(get(`http://localhost:${port}/`, { timeoutMs: 100 })),
    )

    expect(failure).toMatchObject({ kind: 'timeout', sent: true, connection: 'fresh' })
  })

  it('times out a body that stops arriving halfway', async () => {
    const { port } = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Length': '100' })
      res.write('only part of it')
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(
      await transport.send(get(`http://localhost:${port}/`, { timeoutMs: 150 })),
    )

    expect(failure).toMatchObject({ kind: 'timeout', sent: true })
  })

  it('counts resolution against the same deadline', async () => {
    const transport = createNodeTransport({
      allowPrivateTargets: true,
      resolver: () => new Promise(() => {}),
    })

    const failure = expectFailure(
      await transport.send(get('https://api.example.com/', { timeoutMs: 50 })),
    )

    expect(failure).toMatchObject({ kind: 'timeout', sent: false, connection: 'unobserved' })
  })

  it('stops when the caller aborts mid-exchange', async () => {
    const controller = new AbortController()
    const port = await serveRaw((socket) => {
      socket.once('data', () => controller.abort())
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(
      await transport.send(get(`http://localhost:${port}/`, { signal: controller.signal })),
    )

    expect(failure).toMatchObject({ kind: 'aborted', sent: true, connection: 'fresh' })
  })

  it('does nothing at all for a signal that is already aborted', async () => {
    const resolver = vi.fn(LOOPBACK)
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver })

    const failure = expectFailure(
      await transport.send(get('https://api.example.com/', { signal: AbortSignal.abort() })),
    )

    expect(failure).toMatchObject({ kind: 'aborted', sent: false, connection: 'unobserved' })
    expect(resolver).not.toHaveBeenCalled()
  })

  it('stops reading a body past the size limit', async () => {
    const { port } = await serve((_req, res) => res.end('x'.repeat(100)))
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(
      await transport.send(get(`http://localhost:${port}/`, { maxResponseBytes: 10 })),
    )

    expect(failure).toMatchObject({ kind: 'response-too-large', sent: true, connection: 'fresh' })
  })

  it('applies the size limit after decoding, so a small bomb cannot expand past it', async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(4 * 1024 * 1024))
    const { port } = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip' })
      res.end(bomb)
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    expect(bomb.length).toBeLessThan(64 * 1024)
    const failure = expectFailure(
      await transport.send(get(`http://localhost:${port}/`, { maxResponseBytes: 64 * 1024 })),
    )

    expect(failure.kind).toBe('response-too-large')
  })

  it('accepts a body of exactly the size limit', async () => {
    const { port } = await serve((_req, res) => res.end('x'.repeat(10)))
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const response = expectResponse(
      await transport.send(get(`http://localhost:${port}/`, { maxResponseBytes: 10 })),
    )

    expect(response.body.length).toBe(10)
  })

  it('reports bytes that are not HTTP as an unreadable response', async () => {
    const port = await serveRaw((socket) => {
      socket.once('data', () => socket.end('SSH-2.0-OpenSSH_9.6\r\n'))
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(await transport.send(get(`http://localhost:${port}/`)))

    expect(failure).toMatchObject({
      kind: 'unreadable-response',
      sent: true,
      connection: 'fresh',
    })
    expectOpaque(failure, 'SSH')
  })

  it('reports a connection closed before any answer as an unreadable response', async () => {
    const port = await serveRaw((socket) => {
      socket.once('data', () => socket.destroy())
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(await transport.send(get(`http://localhost:${port}/`)))

    expect(failure).toMatchObject({ kind: 'unreadable-response', sent: true })
  })

  it('reports a body cut short by a closed connection as an unreadable response', async () => {
    const port = await serveRaw((socket) => {
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nonly part of it')
        setTimeout(() => socket.destroy(), 20)
      })
    })
    const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

    const failure = expectFailure(await transport.send(get(`http://localhost:${port}/`)))

    expect(failure).toMatchObject({ kind: 'unreadable-response', sent: true })
  })

  it('reports an encoding it cannot decode, or a corrupt compressed body, as unreadable', async () => {
    for (const [encoding, body] of [
      ['zstd', Buffer.from('whatever')],
      ['gzip, br', zlib.brotliCompressSync(zlib.gzipSync('twice'))],
      ['gzip', Buffer.from('not gzip at all')],
    ] as const) {
      const { port } = await serve((_req, res) => {
        res.writeHead(200, { 'Content-Encoding': encoding })
        res.end(body)
      })
      const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

      const failure = expectFailure(await transport.send(get(`http://localhost:${port}/`)))

      expect(failure.kind, encoding).toBe('unreadable-response')
    }
  })
})

describe('malformed requests are the caller’s bug, not a network outcome', () => {
  const transport = createNodeTransport({ allowPrivateTargets: true, resolver: LOOPBACK })

  it.each<[string, TransportRequest]>([
    [
      'an unknown method',
      { method: 'TRACE' as 'GET', url: 'https://api.example.com/', headers: [] },
    ],
    ['a reserved header', get('https://api.example.com/', { headers: [['Host', 'evil.example']] })],
    ['a header that splits', get('https://api.example.com/', { headers: [['x', 'a\r\nb: c']] })],
    ['a scheme that is not HTTP', get('file:///etc/passwd')],
    ['credentials in the URL', get('https://user:pass@api.example.com/')],
    ['something that is not a URL', get('not a url')],
    ['a zero timeout', get('https://api.example.com/', { timeoutMs: 0 })],
    [
      'a timeout setTimeout would overflow',
      get('https://api.example.com/', { timeoutMs: 2 ** 31 }),
    ],
    ['a negative size limit', get('https://api.example.com/', { maxResponseBytes: -1 })],
    ['a fractional size limit', get('https://api.example.com/', { maxResponseBytes: 1.5 })],
  ])('rejects %s', async (_name, request) => {
    await expect(transport.send(request)).rejects.toThrow(TypeError)
  })

  it('never puts the URL in the rejection, since it may carry a credential', async () => {
    await expect(
      transport.send(get('https://user:hunter2-password@api.example.com/')),
    ).rejects.toThrow(/^(?!.*hunter2).*$/s)
  })
})
