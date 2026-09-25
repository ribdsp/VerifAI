/**
 * A bare HTTP client for the daemon, because the tests need what `fetch`
 * will not send: a forged Host, a `//host` target, bytes that are not UTF-8,
 * a body that keeps coming after the limit.
 */

import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import type { Daemon } from '../../src/daemon/server.js'

export interface RawRequest {
  readonly method?: string
  readonly path?: string
  readonly headers?: Readonly<Record<string, string>>
  /** Sent in one piece, with its length declared. */
  readonly body?: string | Uint8Array
  /** Sent chunked, with no declared length. */
  readonly chunks?: readonly Uint8Array[]
}

export interface RawResponse {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

export function raw(port: number, options: RawRequest = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    let answered = false
    const outgoing = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/',
        headers: { ...options.headers },
        agent: false,
      },
      (incoming) => {
        answered = true
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
        incoming.on('error', reject)
      },
    )
    // A server that refuses a body part-way may reset the socket under the rest of it.
    outgoing.on('error', (error) => {
      if (!answered) {
        reject(error)
      }
    })
    if (options.body !== undefined) {
      outgoing.end(options.body)
      return
    }
    for (const chunk of options.chunks ?? []) {
      outgoing.write(chunk)
    }
    outgoing.end()
  })
}

export function bearer(daemon: Daemon): Readonly<Record<string, string>> {
  return Object.freeze({ authorization: `Bearer ${daemon.token}` })
}

export interface ApiResponse extends RawResponse {
  readonly json: unknown
}

/** An authorised API call from the page, with a JSON body when one is given. */
export async function api(
  daemon: Daemon,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const response = await raw(daemon.port, {
    method,
    path,
    headers: {
      ...bearer(daemon),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const isJson = response.headers['content-type']?.startsWith('application/json') === true
  return { ...response, json: isJson ? (JSON.parse(response.body) as unknown) : undefined }
}

export function errorCode(response: ApiResponse): string | undefined {
  return (response.json as { error?: { code?: string } } | undefined)?.error?.code
}

export function errorMessage(response: ApiResponse): string | undefined {
  return (response.json as { error?: { message?: string } } | undefined)?.error?.message
}
