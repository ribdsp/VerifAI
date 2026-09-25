import { describe, expect, it } from 'vitest'
import { testProbe } from '../../core/test/fakes/probes.js'
import { fakeTransport, jsonResponse } from '../../core/test/fakes/transport.js'
import { PRIVATE_TARGETS_REFUSED } from '../src/daemon/routes.js'
import { KEY } from './support/context.js'
import { daemon } from './support/daemon.js'
import { type ApiResponse, api, errorCode, errorMessage } from './support/http.js'

const BODY = Object.freeze({
  endpoint: 'https://gateway.example/v1',
  apiKey: KEY,
  model: 'claude-opus-5-5',
  vendor: 'anthropic',
  protocol: 'anthropic-messages',
  profile: 'quick',
})

type Daemon = Awaited<ReturnType<typeof daemon>>

/** How long a check against the fake transport may take to finish, however slow the runner. */
const SETTLE_MS = 4_000

interface Status {
  readonly state: string
  readonly nextEvent: number
  readonly events: readonly unknown[]
  readonly progress: { readonly done: number; readonly total: number }
}

async function createCheck(d: Daemon, body: object = BODY): Promise<string> {
  const response = await api(d, 'POST', '/api/checks', body)
  if (response.status !== 201) {
    throw new Error(`Expected 201, got ${response.status}: ${response.body}`)
  }
  return (response.json as { checkId: string }).checkId
}

async function settled(d: Daemon, checkId: string): Promise<Status> {
  // A deadline, not a count of attempts: a slow runner gets the same time, not fewer tries.
  const deadline = Date.now() + SETTLE_MS
  while (Date.now() < deadline) {
    const status = (await api(d, 'GET', `/api/checks/${checkId}`)).json as Status
    if (status.state !== 'prepared' && status.state !== 'running') {
      return status
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The check never settled')
}

/** A transport whose every request waits until the test lets it through. */
function heldTransport() {
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const transport = fakeTransport(async () => {
    await held
    return jsonResponse(200, { ok: true })
  })
  return { transport, release: () => release() }
}

function everything(responses: readonly ApiResponse[]): string {
  return responses.map((response) => response.body).join('\n')
}

describe('a check over the API', () => {
  it('goes from an estimate to a report, and never hands the key back', async () => {
    const d = await daemon()
    const created = await api(d, 'POST', '/api/checks', BODY)
    expect(created.status).toBe(201)
    const { checkId, estimate } = created.json as {
      checkId: string
      estimate: { profile: string; probes: unknown[] }
    }
    expect(estimate.profile).toBe('quick')

    const prepared = await api(d, 'GET', `/api/checks/${checkId}`)
    expect((prepared.json as Status).state).toBe('prepared')

    const started = await api(d, 'POST', `/api/checks/${checkId}/start`)
    expect(started.status).toBe(202)
    expect(started.json).toEqual({ checkId, state: 'running' })

    const status = await settled(d, checkId)
    expect(status.state).toBe('finished')
    expect(status.progress.done).toBe(status.progress.total)
    expect(status.events.length).toBe(status.nextEvent)

    const json = await api(d, 'GET', `/api/checks/${checkId}/report`)
    expect(json.status).toBe(200)
    expect(json.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(json.json).toHaveProperty('verdict')

    const markdown = await api(d, 'GET', `/api/checks/${checkId}/report?format=markdown`)
    expect(markdown.headers['content-type']).toBe('text/markdown; charset=utf-8')
    expect(markdown.body).toMatch(/^# /)

    const final = await api(d, 'GET', `/api/checks/${checkId}`)
    expect(everything([created, prepared, started, final, json, markdown])).not.toContain(KEY)
  })

  it('refuses report formats and event cursors it does not know', async () => {
    const d = await daemon()
    const checkId = await createCheck(d)
    const format = await api(d, 'GET', `/api/checks/${checkId}/report?format=html`)
    expect(format.status).toBe(400)
    expect(errorMessage(format)).toBe('format: expected json or markdown')
    const cursor = await api(d, 'GET', `/api/checks/${checkId}?since=-1`)
    expect(cursor.status).toBe(400)
    expect(errorMessage(cursor)).toBe('since: expected a whole number of events')
  })

  it('has no report until the check finishes', async () => {
    const d = await daemon()
    const checkId = await createCheck(d)
    const early = await api(d, 'GET', `/api/checks/${checkId}/report`)
    expect(early.status).toBe(409)
    expect(errorMessage(early)).toBe('The check has no report.')
  })

  it('knows only the checks it made', async () => {
    const d = await daemon()
    for (const [method, path] of [
      ['GET', '/api/checks/nosuchcheck'],
      ['DELETE', '/api/checks/nosuchcheck'],
      ['POST', '/api/checks/nosuchcheck/start'],
      ['GET', '/api/checks/nosuchcheck/report'],
    ] as const) {
      const response = await api(d, method, path)
      expect(response.status).toBe(404)
      expect(errorCode(response)).toBe('not-found')
    }
  })

  it('starts a check once', async () => {
    const d = await daemon()
    const checkId = await createCheck(d)
    expect((await api(d, 'POST', `/api/checks/${checkId}/start`)).status).toBe(202)
    const again = await api(d, 'POST', `/api/checks/${checkId}/start`)
    expect(again.status).toBe(409)
    expect(errorCode(again)).toBe('conflict')
  })

  it('runs one check at a time, and cancels the running one on request', async () => {
    const held = heldTransport()
    // Two probes, so the cancel lands between them rather than after the last.
    const d = await daemon({
      createTransport: () => held.transport,
      checkEnvironment: {
        catalogue: [testProbe('conformance/test/first'), testProbe('conformance/test/second')],
      },
    })
    const checkId = await createCheck(d)
    await api(d, 'POST', `/api/checks/${checkId}/start`)

    const second = await api(d, 'POST', '/api/checks', BODY)
    expect(second.status).toBe(409)
    expect(errorCode(second)).toBe('busy')

    const cancelled = await api(d, 'DELETE', `/api/checks/${checkId}`)
    expect(cancelled.status).toBe(200)
    expect(cancelled.json).toEqual({ checkId, state: 'running' })
    held.release()
    expect((await settled(d, checkId)).state).toBe('cancelled')

    // With the run over, the next one may start.
    expect((await api(d, 'POST', '/api/checks', BODY)).status).toBe(201)
  })

  it('replaces a check that was never started', async () => {
    const d = await daemon()
    const first = await createCheck(d)
    const second = await createCheck(d)
    expect(((await api(d, 'GET', `/api/checks/${first}`)).json as Status).state).toBe('cancelled')
    expect(((await api(d, 'GET', `/api/checks/${second}`)).json as Status).state).toBe('prepared')
    expect((await api(d, 'POST', `/api/checks/${first}/start`)).status).toBe(409)
  })

  it('cancels a prepared check at once', async () => {
    const d = await daemon()
    const checkId = await createCheck(d)
    const cancelled = await api(d, 'DELETE', `/api/checks/${checkId}`)
    expect(cancelled.json).toEqual({ checkId, state: 'cancelled' })
  })
})

describe('what a check may be pointed at', () => {
  it('refuses a private address, as core does', async () => {
    const d = await daemon()
    const response = await api(d, 'POST', '/api/checks', {
      ...BODY,
      endpoint: 'http://127.0.0.1:9/v1',
    })
    expect(response.status).toBe(403)
    expect(errorCode(response)).toBe('blocked-target')
  })

  it('refuses to allow private addresses the daemon itself was not started with', async () => {
    const d = await daemon()
    const response = await api(d, 'POST', '/api/checks', {
      ...BODY,
      endpoint: 'http://127.0.0.1:9/v1',
      allowPrivateTargets: true,
    })
    expect(response.status).toBe(403)
    expect(errorCode(response)).toBe('forbidden')
    expect(errorMessage(response)).toBe(PRIVATE_TARGETS_REFUSED)
  })

  it('allows them per check when it was, and says so to the transport', async () => {
    const allowed: boolean[] = []
    const transport = fakeTransport(() => jsonResponse(200, { ok: true }))
    const d = await daemon({
      allowPrivateTargets: true,
      createTransport: (allow) => {
        allowed.push(allow)
        return transport
      },
    })
    await createCheck(d, { ...BODY, endpoint: 'http://127.0.0.1:9/v1', allowPrivateTargets: true })
    // Without asking, a check is still held to public addresses.
    const refused = await api(d, 'POST', '/api/checks', {
      ...BODY,
      endpoint: 'http://127.0.0.1:9/v1',
    })
    expect(errorCode(refused)).toBe('blocked-target')
    expect(allowed).toEqual([true, false])
  })

  it('refuses an endpoint core cannot use, with core’s message', async () => {
    const d = await daemon()
    const response = await api(d, 'POST', '/api/checks', {
      ...BODY,
      endpoint: 'ftp://gateway.example/v1',
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('invalid-endpoint')
    expect(errorMessage(response)).toBe('endpoint: expected an http or https URL')
  })
})

describe('a failure inside the daemon', () => {
  it('answers 500 with a fixed message and logs only the error’s name', async () => {
    const failures: string[] = []
    const transport = fakeTransport(() => jsonResponse(200, { ok: true }))
    let broken = true
    const d = await daemon({
      createTransport: () => {
        if (broken) {
          broken = false
          throw new RangeError(`broken near ${KEY}`)
        }
        return transport
      },
      onFailure: (detail) => failures.push(detail),
    })
    const response = await api(d, 'POST', '/api/checks', BODY)
    expect(response.status).toBe(500)
    expect(errorCode(response)).toBe('internal')
    expect(response.body).not.toContain(KEY)
    expect(failures).toEqual(['request failed: RangeError'])
    // The store is not left thinking a check is still being prepared.
    expect((await api(d, 'POST', '/api/checks', BODY)).status).toBe(201)
  })
})
