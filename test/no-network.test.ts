import http from 'node:http'
import type { AddressInfo } from 'node:net'
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// TEST-NET-3 (RFC 5737): reserved for documentation, never routed. Even if the
// guard were broken, nothing on the internet would answer.
const UNROUTABLE = '203.0.113.7'

let server: http.Server
let port: number

beforeAll(async () => {
  server = http.createServer((_request, response) => {
    response.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('no-network setup', () => {
  it('blocks fetch to a non-loopback host', async () => {
    await expect(fetch(`http://${UNROUTABLE}/`)).rejects.toThrow(/Blocked network request/)
  })

  it('blocks node:http to a non-loopback host before any socket opens', () => {
    expect(() => http.request({ host: UNROUTABLE, port: 80, agent: false })).toThrow(
      /Blocked network request to 203\.0\.113\.7/,
    )
  })

  it('blocks a raw socket in every argument form net accepts', () => {
    expect(() => net.connect({ host: UNROUTABLE, port: 80 })).toThrow(/Blocked/)
    expect(() => net.connect(80, UNROUTABLE)).toThrow(/Blocked/)
    expect(() => new net.Socket().connect(80, UNROUTABLE)).toThrow(/Blocked/)
  })

  it('lets loopback through on both paths', async () => {
    const viaFetch = await fetch(`http://127.0.0.1:${port}/`)
    expect(await viaFetch.text()).toBe('ok')

    const viaHttp = await new Promise<string>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, agent: false }, (response) => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            body += chunk
          })
          response.on('end', () => resolve(body))
        })
        .on('error', reject)
    })
    expect(viaHttp).toBe('ok')
  })
})
