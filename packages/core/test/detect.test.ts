import { describe, expect, it } from 'vitest'
import {
  DETECT_MAX_RESPONSE_BYTES,
  DETECT_TIMEOUT_MS,
  type DetectOptions,
  detectProtocol,
} from '../src/adapters/detect.js'
import { type Endpoint, parseEndpoint } from '../src/adapters/endpoint.js'
import type { TransportResult } from '../src/transport/types.js'
import { byUrl, failure, fakeTransport, jsonResponse, response } from './fakes/transport.js'
import { fixture } from './fixtures/load.js'

function endpointOf(input: string): Endpoint {
  const result = parseEndpoint(input)
  if (!result.ok) {
    throw new Error(`Test endpoint refused: ${result.problem}`)
  }
  return result.endpoint
}

const ROOT = 'https://gateway.example/v1'
const MESSAGES = `${ROOT}/messages`
const CHAT = `${ROOT}/chat/completions`
const RESPONSES = `${ROOT}/responses`

const anthropicError = (status: number) =>
  jsonResponse(
    status,
    JSON.parse(
      '{"type":"error","error":{"type":"invalid_request_error","message":"model: Field required"},"request_id":"req_011CSHoEeqs5C35K2UUqR7Fy"}',
    ),
  )
const openaiError = (status: number) =>
  jsonResponse(
    status,
    JSON.parse(
      '{"error":{"message":"Missing required parameter: \'model\'.","type":"invalid_request_error","param":"model","code":"missing_required_parameter"}}',
    ),
  )

async function detect(
  table: Readonly<Record<string, TransportResult>>,
  options: Partial<DetectOptions> = {},
) {
  const transport = fakeTransport(byUrl(table))
  const detection = await detectProtocol({ transport, endpoint: endpointOf(ROOT), ...options })
  return { detection, transport }
}

const outcomes = (detection: Awaited<ReturnType<typeof detectProtocol>>) =>
  Object.fromEntries(detection.attempts.map(({ protocol, outcome }) => [protocol, outcome]))

describe('detectProtocol', () => {
  it('finds the one protocol an endpoint serves', async () => {
    const { detection } = await detect({ [MESSAGES]: anthropicError(400) })
    expect(detection.protocol).toBe('anthropic-messages')
    expect(detection.ranked).toEqual(['anthropic-messages'])
    expect(outcomes(detection)).toEqual({
      'anthropic-messages': { kind: 'speaks', status: 400, dialect: 'anthropic', ownDialect: true },
      'openai-chat': { kind: 'absent', status: 404 },
      'openai-responses': { kind: 'absent', status: 404 },
    })
  })

  it('ranks protocols that answer equally in the order PROTOCOLS lists them', async () => {
    const { detection } = await detect({ [CHAT]: openaiError(400), [RESPONSES]: openaiError(400) })
    expect(detection.ranked).toEqual(['openai-chat', 'openai-responses'])
    expect(detection.protocol).toBe('openai-chat')
  })

  describe('when every protocol answers in its own dialect', () => {
    const table = {
      [MESSAGES]: anthropicError(400),
      [CHAT]: openaiError(400),
      [RESPONSES]: openaiError(400),
    }

    it("prefers the claimed model's vendor", async () => {
      const claude = await detect(table, { claimedModel: 'claude-opus-5' })
      expect(claude.detection.ranked).toEqual([
        'anthropic-messages',
        'openai-chat',
        'openai-responses',
      ])
      const gpt = await detect(table, { claimedModel: 'gpt-6-astra' })
      expect(gpt.detection.ranked).toEqual([
        'openai-chat',
        'openai-responses',
        'anthropic-messages',
      ])
    })

    it('prefers the protocol the pasted URL named over the claimed vendor', async () => {
      const { detection } = await detect(table, {
        endpoint: endpointOf(RESPONSES),
        claimedModel: 'claude-opus-5',
      })
      expect(detection.protocol).toBe('openai-responses')
    })

    it('falls back to PROTOCOLS order for a model that names no vendor', async () => {
      const { detection } = await detect(table, { claimedModel: 'deepseek-v4' })
      expect(detection.protocol).toBe('anthropic-messages')
    })
  })

  it("ranks a route that fails in its own vendor's dialect above one that fails in another's", async () => {
    const { detection } = await detect(
      { [MESSAGES]: openaiError(400), [CHAT]: openaiError(400) },
      { claimedModel: 'claude-opus-5' },
    )
    expect(detection.ranked).toEqual(['openai-chat', 'anthropic-messages'])
    expect(outcomes(detection)['anthropic-messages']).toEqual({
      kind: 'speaks',
      status: 400,
      dialect: 'openai',
      ownDialect: false,
    })
  })

  it('counts an authentication refusal as the route speaking', async () => {
    const { detection } = await detect({ [MESSAGES]: anthropicError(401) })
    expect(detection.protocol).toBe('anthropic-messages')
  })

  it('ranks a route that generates in answer to {} last, and only as its own protocol', async () => {
    const { detection } = await detect({
      [MESSAGES]: jsonResponse(200, fixture('openai-chat.documented.json')),
      [CHAT]: jsonResponse(200, fixture('openai-chat.documented.json')),
      [RESPONSES]: openaiError(400),
    })
    expect(detection.ranked).toEqual(['openai-responses', 'openai-chat'])
    expect(outcomes(detection)).toMatchObject({
      'anthropic-messages': { kind: 'accepted', status: 200, readsAs: 'openai-chat' },
      'openai-chat': { kind: 'accepted', status: 200, readsAs: 'openai-chat' },
    })
  })

  it('reads a success that is no generation as accepted, and does not rank it', async () => {
    const { detection } = await detect({ [MESSAGES]: jsonResponse(200, { ok: true }) })
    expect(outcomes(detection)['anthropic-messages']).toEqual({
      kind: 'accepted',
      status: 200,
      readsAs: undefined,
    })
    expect(detection.protocol).toBeUndefined()
  })

  it('treats 404 and 405 as absent, whatever else the body says', async () => {
    const { detection } = await detect({
      [MESSAGES]: anthropicError(404),
      [CHAT]: response(405, 'Method Not Allowed'),
    })
    expect(outcomes(detection)).toMatchObject({
      'anthropic-messages': { kind: 'absent', status: 404 },
      'openai-chat': { kind: 'absent', status: 405 },
    })
    expect(detection.ranked).toEqual([])
  })

  it('counts a 404 that says the model was not found as the route speaking', async () => {
    const modelNotFound = jsonResponse(
      404,
      JSON.parse(
        '{"error":{"message":"The model `x` does not exist or you do not have access to it.","type":"invalid_request_error","param":null,"code":"model_not_found"}}',
      ),
    )
    const { detection } = await detect(
      { [MESSAGES]: modelNotFound, [CHAT]: modelNotFound, [RESPONSES]: modelNotFound },
      { claimedModel: 'claude-opus-4-6' },
    )
    expect(outcomes(detection)).toEqual({
      'anthropic-messages': { kind: 'speaks', status: 404, dialect: 'openai', ownDialect: false },
      'openai-chat': { kind: 'speaks', status: 404, dialect: 'openai', ownDialect: true },
      'openai-responses': { kind: 'speaks', status: 404, dialect: 'openai', ownDialect: true },
    })
    expect(detection.ranked).toEqual(['openai-chat', 'openai-responses', 'anthropic-messages'])
  })

  describe("when routes refuse {} in a platform's own JSON, as Snowflake Cortex does", () => {
    const platform = (status: number, message: string) =>
      jsonResponse(status, {
        code: '399302',
        message,
        ...JSON.parse('{"request_id":"f3f5e1e2","error_code":"399302"}'),
      })
    const table = {
      [MESSAGES]: platform(400, 'Missing required field: model'),
      [CHAT]: platform(422, 'Missing required field: model'),
      [RESPONSES]: platform(403, 'Responses REST API not enabled'),
    }

    it('counts a validation refusal as the route being there, and nothing else', async () => {
      const { detection } = await detect(table)
      expect(outcomes(detection)).toEqual({
        'anthropic-messages': { kind: 'refuses', status: 400 },
        'openai-chat': { kind: 'refuses', status: 422 },
        'openai-responses': { kind: 'unclear', status: 403, body: 'json' },
      })
      expect(detection.ranked).toEqual(['anthropic-messages', 'openai-chat'])
    })

    it("prefers the claimed model's vendor among them", async () => {
      const gpt = await detect(table, { claimedModel: 'openai-gpt-5.4' })
      expect(gpt.detection.protocol).toBe('openai-chat')
      const claude = await detect(table, { claimedModel: 'claude-haiku-4-5' })
      expect(claude.detection.protocol).toBe('anthropic-messages')
    })

    it('ranks such a refusal below any answer in a vendor dialect or a generation', async () => {
      const { detection } = await detect({
        [MESSAGES]: platform(400, 'Missing required field: model'),
        [CHAT]: jsonResponse(200, fixture('openai-chat.documented.json')),
      })
      expect(detection.ranked).toEqual(['openai-chat', 'anthropic-messages'])
    })
  })

  it('keeps apart the answers it cannot read', async () => {
    const { detection } = await detect({
      [MESSAGES]: response(502, '<html>Bad Gateway</html>'),
      [CHAT]: jsonResponse(400, ['bad request']),
      [RESPONSES]: response(200),
    })
    expect(outcomes(detection)).toEqual({
      'anthropic-messages': { kind: 'unclear', status: 502, body: 'not-json' },
      'openai-chat': { kind: 'unclear', status: 400, body: 'json' },
      'openai-responses': { kind: 'unclear', status: 200, body: 'empty' },
    })
    expect(detection.protocol).toBeUndefined()
  })

  it('reports transport failures by kind and finds nothing', async () => {
    const transport = fakeTransport(() => failure('dns-failure'))
    const detection = await detectProtocol({ transport, endpoint: endpointOf(ROOT) })
    expect(detection.attempts.map(({ outcome }) => outcome)).toEqual([
      { kind: 'failed', failure: 'dns-failure' },
      { kind: 'failed', failure: 'dns-failure' },
      { kind: 'failed', failure: 'dns-failure' },
    ])
    expect(detection.protocol).toBeUndefined()
  })

  it('keeps each transport result for the probes that come after', async () => {
    const answer = anthropicError(400)
    const { detection } = await detect({ [MESSAGES]: answer })
    expect(detection.attempts[0]?.result).toBe(answer)
  })

  it('posts {} to every generate operation with its limits, the key and the signal', async () => {
    const signal = new AbortController().signal
    const { transport } = await detect({}, { apiKey: 'test-key-0000', signal })
    expect(transport.requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `POST ${MESSAGES}`,
      `POST ${CHAT}`,
      `POST ${RESPONSES}`,
    ])
    for (const request of transport.requests) {
      expect(new TextDecoder().decode(request.body)).toBe('{}')
      expect(request).toMatchObject({
        timeoutMs: DETECT_TIMEOUT_MS,
        maxResponseBytes: DETECT_MAX_RESPONSE_BYTES,
        signal,
      })
    }
    expect(transport.requests[0]?.headers).toContainEqual(['X-Api-Key', 'test-key-0000'])
    expect(transport.requests[1]?.headers).toContainEqual(['Authorization', 'Bearer test-key-0000'])
  })

  it("sends the key in the buyer's scheme to every protocol that takes it", async () => {
    const { transport } = await detect({}, { apiKey: 'test-key-0000', auth: 'bearer' })
    for (const request of transport.requests) {
      expect(request.headers).toContainEqual(['Authorization', 'Bearer test-key-0000'])
      expect(request.headers.map(([name]) => name.toLowerCase())).not.toContain('x-api-key')
    }
  })

  it('uses the timeout it is given, and sends no credential without a key', async () => {
    const { transport } = await detect({}, { timeoutMs: 5_000 })
    for (const request of transport.requests) {
      expect(request.timeoutMs).toBe(5_000)
      expect(request.headers.map(([name]) => name.toLowerCase())).not.toContain('authorization')
      expect(request.headers.map(([name]) => name.toLowerCase())).not.toContain('x-api-key')
    }
  })

  it('refuses a key that cannot be sent before sending anything', async () => {
    const transport = fakeTransport(byUrl({}))
    await expect(
      detectProtocol({ transport, endpoint: endpointOf(ROOT), apiKey: 'bad\nkey' }),
    ).rejects.toThrow(new TypeError('The API key cannot be sent: invalid-character'))
    expect(transport.requests).toEqual([])
  })

  it('passes on a transport that rejects rather than calling it a finding', async () => {
    const transport = fakeTransport(() => Promise.reject(new TypeError('malformed request')))
    await expect(detectProtocol({ transport, endpoint: endpointOf(ROOT) })).rejects.toThrow(
      'malformed request',
    )
  })

  it('freezes what it returns', async () => {
    const { detection } = await detect({ [MESSAGES]: anthropicError(400) })
    expect(Object.isFrozen(detection)).toBe(true)
    expect(Object.isFrozen(detection.attempts)).toBe(true)
    expect(Object.isFrozen(detection.ranked)).toBe(true)
    for (const attempt of detection.attempts) {
      expect(Object.isFrozen(attempt)).toBe(true)
      expect(Object.isFrozen(attempt.outcome)).toBe(true)
    }
  })
})
