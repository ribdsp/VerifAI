/**
 * Reading a JSON request body, bounded before it is buffered.
 *
 * The largest legitimate body is a check request - an endpoint, a model name
 * and a key - which is well under the limit. A declared length over the limit
 * is refused before a byte is read; an undeclared one is counted as it
 * arrives and cut off the moment it passes the limit.
 */

import type { IncomingMessage } from 'node:http'

export const MAX_BODY_BYTES = 64 * 1024

export type BodyResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problem: 'too-large' | 'unreadable' }

/** Whether the body is declared as JSON; parameters such as `charset` are allowed. */
export function isJsonBody(request: IncomingMessage): boolean {
  const type = request.headers['content-type']
  return type?.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

function declaredTooLarge(request: IncomingMessage, limit: number): boolean {
  const declared = request.headers['content-length']
  return declared !== undefined && !(/^\d{1,12}$/.test(declared) && Number(declared) <= limit)
}

export function readBody(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<BodyResult> {
  if (declaredTooLarge(request, limit)) {
    return Promise.resolve({ ok: false, problem: 'too-large' })
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const settle = (result: BodyResult) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > limit) {
        // Stop buffering; the response closes the connection.
        request.pause()
        settle({ ok: false, problem: 'too-large' })
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true })
        settle({ ok: true, text: decoder.decode(Buffer.concat(chunks)) })
      } catch {
        settle({ ok: false, problem: 'unreadable' })
      }
    })
    request.on('error', () => settle({ ok: false, problem: 'unreadable' }))
    request.on('aborted', () => settle({ ok: false, problem: 'unreadable' }))
  })
}

export type JsonResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

export function parseJson(text: string): JsonResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}
