import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A stand-in for a seller's endpoint, on loopback. It answers the Messages API
 * the way a thin, permissive layer would: a well-formed request gets a 200, a
 * body that is not JSON gets Anthropic's 400, an unknown path Anthropic's 404.
 * That is enough for a check to run to its report with no network and no key
 * worth anything. It keeps the keys it is sent, so a spec can see the key the
 * page took reached the endpoint.
 */

export interface FakeUpstream {
  /** The base URL to check: `http://127.0.0.1:<port>/v1`. */
  readonly baseUrl: string
  /** Every key sent to it, in `x-api-key` or as a bearer token, in order. */
  readonly keysSeen: () => readonly string[]
  readonly close: () => Promise<void>
}

/** A bound on what the fake reads, far above anything a probe sends. */
const MAX_BODY_BYTES = 1_000_000
const MODEL_CREATED = '2026-01-01T00:00:00Z'
const BEARER = /^Bearer (.+)$/

type Body = { readonly json: unknown } | { readonly malformed: true }

function readBody(request: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.destroy()
        reject(new Error(`a request body over ${MAX_BODY_BYTES} bytes`))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve({ json: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        resolve({ malformed: true })
      }
    })
    request.on('error', reject)
  })
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const anthropicError = (type: string, message: string) => ({
  type: 'error',
  error: { type, message },
})

const field = (json: unknown, name: string): unknown =>
  typeof json === 'object' && json !== null ? (json as Record<string, unknown>)[name] : undefined

// biome-ignore-start lint/style/useNamingConvention: Anthropic's wire names.
function message(json: unknown) {
  const model = field(json, 'model')
  return {
    id: 'msg_e2e',
    type: 'message',
    role: 'assistant',
    model: typeof model === 'string' ? model : 'unknown',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: field(json, 'max_tokens') === 1 ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 8, output_tokens: 1 },
  }
}

const modelObject = (id: string) => ({
  type: 'model',
  id,
  display_name: id,
  created_at: MODEL_CREATED,
})

const tokenCount = { input_tokens: 8 }
// biome-ignore-end lint/style/useNamingConvention: Anthropic's wire names.

function keyOf(request: IncomingMessage): string | undefined {
  const header = request.headers['x-api-key']
  if (typeof header === 'string') {
    return header
  }
  return BEARER.exec(request.headers.authorization ?? '')?.[1]
}

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (request.method === 'GET') {
    const retrieved = /\/models\/([^/]+)$/.exec(path)
    if (retrieved?.[1] !== undefined) {
      send(response, 200, modelObject(decodeURIComponent(retrieved[1])))
      return
    }
    if (path.endsWith('/models')) {
      send(response, 200, { data: [modelObject('claude-opus-5-5')] })
      return
    }
  }
  if (request.method === 'POST' && /\/messages(\/count_tokens)?$/.test(path)) {
    const body = await readBody(request)
    if ('malformed' in body) {
      send(response, 400, anthropicError('invalid_request_error', 'The body is not valid JSON.'))
      return
    }
    send(response, 200, path.endsWith('/count_tokens') ? tokenCount : message(body.json))
    return
  }
  send(response, 404, anthropicError('not_found_error', 'Not found.'))
}

export function startFakeUpstream(): Promise<FakeUpstream> {
  const keys: string[] = []
  const server = createServer((request, response) => {
    const key = keyOf(request)
    if (key !== undefined) {
      keys.push(key)
    }
    answer(request, response).catch((error: unknown) => {
      console.error('fake upstream:', error)
      if (!response.headersSent) {
        send(response, 500, anthropicError('api_error', 'The fake upstream failed.'))
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        keysSeen: () => [...keys],
        close: () =>
          new Promise((done) => {
            server.closeAllConnections()
            server.close(() => done())
          }),
      })
    })
  })
}
