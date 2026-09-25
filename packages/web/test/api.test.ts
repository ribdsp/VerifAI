import { describe, expect, it } from 'vitest'
import {
  ApiClientError,
  createApiClient,
  errorFromBody,
  messageOf,
  parseStatus,
} from '../src/lib/api'
import { forgetSessionToken, takeSessionToken } from '../src/lib/session'
import {
  CREATED,
  checkEvent,
  fakeFetch,
  headersOf,
  jsonResponse,
  OPTIONS,
  REPORT,
  statusOf,
  TOKEN,
} from './fixtures'

// Assembled, so the secret scan does not read a test value as a leaked key.
const API_KEY = ['sk', 'test', 'DO', 'NOT', 'LEAK', '0123456789'].join('-')

function clientWith(respond?: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch(respond)
  const client = createApiClient({ fetch: fake.fetch, token: () => TOKEN })
  return { client, calls: fake.calls }
}

async function rejectionOf(promise: Promise<unknown>): Promise<ApiClientError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  if (!(error instanceof ApiClientError)) {
    throw new Error('expected the call to reject with an ApiClientError')
  }
  return error
}

describe('request shape', () => {
  it('sends a GET with the bearer header, no content type and nothing ambient', async () => {
    const { client, calls } = clientWith(() => jsonResponse({ ok: true, version: '0.1.0' }))

    await expect(client.health()).resolves.toEqual({ ok: true, version: '0.1.0' })

    const [call] = calls
    expect(call?.input).toBe('/api/health')
    expect(call?.init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    })
    expect(headersOf(call)).toEqual({ authorization: `Bearer ${TOKEN}` })
    expect(call?.init.body).toBeUndefined()
  })

  it('posts the check request as JSON, with the key in the body and nowhere else', async () => {
    const { client, calls } = clientWith(() => jsonResponse(CREATED, 201))
    const request = {
      endpoint: 'https://api.example.com',
      apiKey: API_KEY,
      model: 'claude-sonnet-5',
      vendor: 'auto',
      protocol: 'auto',
      profile: 'standard',
    } as const

    await expect(client.createCheck(request)).resolves.toEqual(CREATED)

    const [call] = calls
    expect(call?.input).toBe('/api/checks')
    expect(call?.init.method).toBe('POST')
    expect(headersOf(call)).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(call?.init.body))).toEqual(request)
    expect(call?.input).not.toContain(API_KEY)
    expect(JSON.stringify(headersOf(call))).not.toContain(API_KEY)
  })

  it('starts with a POST and cancels with a DELETE, both with a JSON content type', async () => {
    const { client, calls } = clientWith(() => new Response(null, { status: 204 }))

    await client.startCheck('chk/01')
    await client.cancelCheck('chk/01')

    expect(calls.map((call) => [call.init.method, call.input])).toEqual([
      ['POST', '/api/checks/chk%2F01/start'],
      ['DELETE', '/api/checks/chk%2F01'],
    ])
    for (const call of calls) {
      expect(headersOf(call)['content-type']).toBe('application/json')
      expect(call.init.body).toBeUndefined()
    }
  })

  it('asks for status since a whole, non-negative event number', async () => {
    const { client, calls } = clientWith(() => jsonResponse(statusOf()))

    await client.status('chk_01', 3.9)
    await client.status('chk_01', -2)

    expect(calls.map((call) => call.input)).toEqual([
      '/api/checks/chk_01?since=3',
      '/api/checks/chk_01?since=0',
    ])
  })

  it('fetches the JSON report, and downloads either format as a blob', async () => {
    const { client, calls } = clientWith(({ input }) =>
      input.endsWith('markdown') ? new Response('# Report') : jsonResponse(REPORT),
    )

    await expect(client.report('chk_01')).resolves.toEqual(REPORT)
    const blob = await client.download('chk_01', 'markdown')

    await expect(blob.text()).resolves.toBe('# Report')
    expect(calls.map((call) => call.input)).toEqual([
      '/api/checks/chk_01/report?format=json',
      '/api/checks/chk_01/report?format=markdown',
    ])
    expect(headersOf(calls[1]).authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('reads the token from the session module by default', async () => {
    const fake = fakeFetch(() => jsonResponse(OPTIONS))
    const client = createApiClient({ fetch: fake.fetch })
    takeSessionToken({ hash: `#token=${TOKEN}`, pathname: '/', search: '' }, { replaceState() {} })

    try {
      await expect(client.options()).resolves.toEqual(OPTIONS)
      expect(headersOf(fake.calls[0]).authorization).toBe(`Bearer ${TOKEN}`)
    } finally {
      forgetSessionToken()
    }
  })
})

describe('failures', () => {
  it('refuses to call without a session token', async () => {
    const fake = fakeFetch()
    const client = createApiClient({ fetch: fake.fetch, token: () => undefined })

    const error = await rejectionOf(client.health())

    expect(error.code).toBe('no-session')
    expect(fake.calls).toHaveLength(0)
  })

  it('turns the error envelope into its code, message and status', async () => {
    const { client } = clientWith(() =>
      jsonResponse({ error: { code: 'invalid-endpoint', message: 'endpoint: not a URL' } }, 400),
    )

    const error = await rejectionOf(client.createCheck({} as never))

    expect(error).toMatchObject({
      code: 'invalid-endpoint',
      message: 'endpoint: not a URL',
      status: 400,
    })
  })

  it('bounds a long daemon message', () => {
    const error = errorFromBody({ error: { code: 'internal', message: 'x'.repeat(5000) } }, 500)

    expect(error.message).toHaveLength(600)
  })

  it('names only the status for an error body it cannot read', async () => {
    const { client } = clientWith(() => new Response('<html>Bad gateway</html>', { status: 502 }))

    const error = await rejectionOf(client.health())

    expect(error).toMatchObject({ code: 'http', status: 502 })
    expect(error.message).toBe('The daemon answered with HTTP 502.')
    expect(errorFromBody({ error: { code: 'made-up', message: 'x' } }, 418).code).toBe('http')
  })

  it('reports a success body that is not JSON, or not the expected shape, as malformed', async () => {
    const notJson = clientWith(() => new Response('not json', { status: 200 }))
    const wrongShape = clientWith(() => jsonResponse({ ok: 'yes' }))
    const noEstimate = clientWith(() => jsonResponse({ checkId: 'chk_01' }))

    expect((await rejectionOf(notJson.client.health())).code).toBe('malformed-response')
    expect((await rejectionOf(wrongShape.client.health())).code).toBe('malformed-response')
    expect((await rejectionOf(noEstimate.client.createCheck({} as never))).code).toBe(
      'malformed-response',
    )
  })

  it('reports a network failure without echoing the request', async () => {
    const { client } = clientWith(() => Promise.reject(new TypeError(`failed ${API_KEY}`)))

    const error = await rejectionOf(client.createCheck({ apiKey: API_KEY } as never))

    expect(error.code).toBe('network')
    expect(error.status).toBeNull()
    expect(error.message).not.toContain(API_KEY)
  })

  it('reports an aborted call as aborted', async () => {
    const controller = new AbortController()
    const { client } = clientWith(() => {
      controller.abort()
      return Promise.reject(new DOMException('aborted', 'AbortError'))
    })

    const error = await rejectionOf(client.options(controller.signal))

    expect(error.code).toBe('aborted')
  })
})

describe('parseStatus', () => {
  it('drops events of kinds this page does not know', () => {
    const status = parseStatus({
      ...statusOf({ nextEvent: 3 }),
      events: [
        checkEvent(0, { kind: 'probe-started', probeId: 'A1', index: 0, total: 2 }),
        { seq: 1, event: { kind: 'telemetry', probeId: 'A1' } },
        checkEvent(2, { kind: 'draw', draw: 1, outcome: 'agree' }),
      ],
    })

    expect(status.events.map((entry) => entry.seq)).toEqual([0, 2])
  })

  it('keeps a well-formed error and rejects a malformed one', () => {
    const error = { code: 'unreachable', message: 'The endpoint could not be reached.' }

    expect(parseStatus({ ...statusOf({ state: 'stopped' }), error }).error).toEqual(error)
    expect(() => parseStatus({ ...statusOf(), error: { code: 'nope' } })).toThrow(ApiClientError)
  })

  it('rejects a status with an unknown state, bad counts or a broken report', () => {
    expect(() => parseStatus({ ...statusOf(), state: 'paused' })).toThrow(ApiClientError)
    expect(() => parseStatus({ ...statusOf(), nextEvent: -1 })).toThrow(ApiClientError)
    expect(() => parseStatus({ ...statusOf(), report: { reportVersion: 99 } })).toThrow(
      ApiClientError,
    )
  })
})

describe('messageOf', () => {
  it('shows a client error as it is, and anything else as a fixed line', () => {
    expect(messageOf(new ApiClientError('busy', 'Busy.'))).toBe('Busy.')
    expect(messageOf(new Error(`boom ${API_KEY}`))).toBe('Something went wrong in this page.')
  })
})
