import { describe, expect, it } from 'vitest'
import { adapterFor, authFor, buildRequest, type RequestSpec } from '../src/adapters/adapter.js'
import { anthropicMessages } from '../src/adapters/anthropic-messages.js'
import { type Endpoint, modelPath, parseEndpoint } from '../src/adapters/endpoint.js'
import { openaiChat } from '../src/adapters/openai-chat.js'
import { openaiResponses } from '../src/adapters/openai-responses.js'
import { PROTOCOLS, type Protocol } from '../src/types/target.js'

function endpointOf(input: string): Endpoint {
  const result = parseEndpoint(input)
  if (!result.ok) {
    throw new Error(`Test endpoint refused: ${result.problem}`)
  }
  return result.endpoint
}

const endpoint = endpointOf('https://gateway.example/v1')
const apiKey = 'test-key-0000'
const PAYLOAD: unknown = JSON.parse('{"model":"claude-opus-5","max_tokens":1}')
const spec = (overrides: Partial<RequestSpec> = {}): RequestSpec => ({
  endpoint,
  path: anthropicMessages.generatePath,
  apiKey,
  body: { json: PAYLOAD },
  ...overrides,
})
const decoded = (body: Uint8Array | undefined) => new TextDecoder().decode(body)

describe('adapterFor', () => {
  it('has an adapter for every protocol, and each is that protocol', () => {
    for (const protocol of PROTOCOLS.values) {
      expect(adapterFor(protocol).protocol).toBe(protocol)
    }
  })

  it('refuses what is not a protocol instead of returning undefined', () => {
    expect(() => adapterFor('openai-completions' as Protocol)).toThrow(
      new TypeError(
        'Unknown protocol "openai-completions"; expected one of anthropic-messages, openai-chat, openai-responses',
      ),
    )
  })
})

describe('buildRequest', () => {
  it('posts a JSON body to the operation under the endpoint root, with the default headers', () => {
    const request = buildRequest(anthropicMessages, spec())
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://gateway.example/v1/messages')
    expect(request.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
      ['anthropic-version', '2023-06-01'],
      ['X-Api-Key', apiKey],
    ])
    expect(JSON.parse(decoded(request.body))).toEqual(PAYLOAD)
  })

  it('gets without a body, and then sends no content type', () => {
    const request = buildRequest(openaiChat, {
      endpoint,
      path: modelPath('gpt-6-astra'),
      apiKey,
    })
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://gateway.example/v1/models/gpt-6-astra')
    expect(request.headers).toEqual([
      ['Accept', 'application/json'],
      ['Authorization', `Bearer ${apiKey}`],
    ])
    expect(request.body).toBeUndefined()
  })

  it('uses the method it is given', () => {
    const { body: _omitted, ...withoutBody } = spec({ method: 'OPTIONS' })
    expect(buildRequest(openaiChat, withoutBody).method).toBe('OPTIONS')
  })

  it('sends the key the way the auth scheme says', () => {
    const request = buildRequest(anthropicMessages, spec({ auth: 'bearer' }))
    expect(request.headers).toContainEqual(['Authorization', `Bearer ${apiKey}`])
    expect(request.headers.map(([name]) => name)).not.toContain('X-Api-Key')
  })

  it('refuses an auth scheme the protocol does not document', () => {
    expect(() => buildRequest(openaiChat, spec({ auth: 'x-api-key' }))).toThrow(TypeError)
  })

  it("takes the buyer's scheme where the protocol documents it, and its own first otherwise", () => {
    expect(authFor(anthropicMessages, 'bearer')).toBe('bearer')
    expect(authFor(anthropicMessages, undefined)).toBe('x-api-key')
    expect(authFor(openaiChat, 'x-api-key')).toBe('bearer')
    expect(authFor(openaiResponses, 'bearer')).toBe('bearer')
  })

  it('sends no credential when there is no key', () => {
    const { apiKey: _omitted, ...withoutKey } = spec()
    const names = buildRequest(anthropicMessages, withoutKey).headers.map(([name]) => name)
    expect(names).toEqual(['Content-Type', 'Accept', 'anthropic-version'])
  })

  it('sends the key without the whitespace a paste adds', () => {
    const request = buildRequest(openaiChat, spec({ apiKey: `  ${apiKey}\r\n` }))
    expect(request.headers).toContainEqual(['Authorization', `Bearer ${apiKey}`])
  })

  it('refuses a key that cannot go into a header, naming the problem and not the key', () => {
    const secret = 'secret-é-value'
    let thrown: unknown
    try {
      buildRequest(openaiChat, spec({ apiKey: secret }))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toEqual(new TypeError('The API key cannot be sent: invalid-character'))
    expect(String(thrown)).not.toContain('secret')
  })

  it('puts the given headers after the defaults, replacing any of the same name', () => {
    const request = buildRequest(
      anthropicMessages,
      spec({
        headers: [
          ['Anthropic-Version', '2020-01-01'],
          ['anthropic-beta', 'one'],
          ['anthropic-beta', 'two'],
        ],
      }),
    )
    expect(request.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
      ['X-Api-Key', apiKey],
      ['Anthropic-Version', '2020-01-01'],
      ['anthropic-beta', 'one'],
      ['anthropic-beta', 'two'],
    ])
  })

  it('leaves out the defaults it is told to', () => {
    const request = buildRequest(
      anthropicMessages,
      spec({ withoutHeaders: ['content-type', 'accept', 'ANTHROPIC-VERSION'] }),
    )
    expect(request.headers).toEqual([['X-Api-Key', apiKey]])
  })

  it('refuses a header the transport would refuse', () => {
    expect(() => buildRequest(openaiChat, spec({ headers: [['Host', 'api.openai.com']] }))).toThrow(
      new TypeError('Header Host is reserved for the transport'),
    )
    expect(() =>
      buildRequest(openaiChat, spec({ headers: [['X-Probe', 'a\r\nX-Evil: 1']] })),
    ).toThrow(TypeError)
  })

  it('sends bytes exactly, and not what the caller writes into them afterwards', () => {
    const bytes = new TextEncoder().encode('{"model":')
    const request = buildRequest(openaiChat, spec({ body: { bytes } }))
    bytes[0] = 0x5b
    expect(decoded(request.body)).toBe('{"model":')
    expect(request.headers).toContainEqual(['Content-Type', 'application/json'])
  })

  it('refuses a JSON body that JSON cannot represent', () => {
    expect(() => buildRequest(openaiChat, spec({ body: { json: undefined } }))).toThrow(
      new TypeError('A JSON request body must be a value JSON can represent'),
    )
  })

  it('passes the limits and the signal through, and adds none of its own', () => {
    const signal = new AbortController().signal
    const limited = buildRequest(
      openaiChat,
      spec({ timeoutMs: 20_000, maxResponseBytes: 65_536, signal }),
    )
    expect(limited).toMatchObject({ timeoutMs: 20_000, maxResponseBytes: 65_536, signal })

    const unlimited = buildRequest(openaiChat, spec())
    expect(Object.keys(unlimited).sort()).toEqual(['body', 'headers', 'method', 'url'])
  })

  it('freezes the request and its headers', () => {
    const request = buildRequest(anthropicMessages, spec({ headers: [['anthropic-beta', 'x']] }))
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.headers)).toBe(true)
    expect(request.headers.every((pair) => Object.isFrozen(pair))).toBe(true)
  })
})
