import type { Server, ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { daemon } from './support/daemon.js'
import { api } from './support/http.js'

/** Every server the daemon creates, so a test can make one fail after it listens. */
const servers = vi.hoisted((): Server[] => [])

vi.mock('node:http', async (importOriginal) => {
  const http = await importOriginal<typeof import('node:http')>()
  return {
    ...http,
    createServer: (...args: Parameters<typeof http.createServer>) => {
      const server = http.createServer(...args)
      servers.push(server)
      return server
    },
  }
})

function lastServer(): Server {
  const server = servers.at(-1)
  if (server === undefined) {
    throw new Error('No server was created')
  }
  return server
}

describe('a failure of the daemon’s own server', () => {
  it('is reported by name after listening, and the daemon keeps answering', async () => {
    const failures: string[] = []
    const d = await daemon({ onFailure: (detail) => failures.push(detail) })
    const exhausted = Object.assign(new Error('accept failed near a path'), { code: 'EMFILE' })

    // Without a listener, an 'error' event is thrown, and the daemon goes with it.
    expect(() => lastServer().emit('error', exhausted)).not.toThrow()

    expect(failures).toEqual(['server failed: Error'])
    expect((await api(d, 'GET', '/api/health')).status).toBe(200)
  })

  it('reports a reply whose socket fails, by name, and keeps serving', async () => {
    const failures: string[] = []
    const d = await daemon({ onFailure: (detail) => failures.push(detail) })
    // Added after the daemon's own listener, so the reply already has its guard.
    lastServer().once('request', (_request, response: ServerResponse) => {
      expect(() => response.emit('error', new Error('write after a reset'))).not.toThrow()
    })

    expect((await api(d, 'GET', '/api/health')).status).toBe(200)
    expect(failures).toEqual(['response failed: Error'])
    expect((await api(d, 'GET', '/api/health')).status).toBe(200)
  })

  it('does not report a port that is taken twice, once as a failure', async () => {
    const failures: string[] = []
    const first = await daemon()
    await expect(
      daemon({ port: first.port, onFailure: (detail) => failures.push(detail) }),
    ).rejects.toThrow(`Port ${first.port} is already in use.`)
    expect(failures).toEqual([])
  })

  it('closes with a request still arriving, without an error of its own', async () => {
    const failures: string[] = []
    const d = await daemon({ onFailure: (detail) => failures.push(detail) })
    const socket = connect(d.port, '127.0.0.1')
    await new Promise<void>((resolve) => socket.once('connect', resolve))
    const closedByServer = new Promise<void>((resolve) => socket.once('close', () => resolve()))
    socket.on('error', () => undefined)
    // Headers and half a body: the handler is waiting on the rest when the daemon closes.
    socket.write(
      [
        'POST /api/checks HTTP/1.1',
        `Host: 127.0.0.1:${d.port}`,
        `Authorization: Bearer ${d.token}`,
        'Content-Type: application/json',
        'Content-Length: 100',
        '',
        '{"endpoint":',
      ].join('\r\n'),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    await d.close()
    await closedByServer
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(failures).toEqual([])
  })
})
