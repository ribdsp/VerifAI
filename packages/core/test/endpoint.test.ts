import { describe, expect, it } from 'vitest'
import {
  ENDPOINT_PROBLEMS,
  type Endpoint,
  MAX_ENDPOINT_LENGTH,
  modelPath,
  operationUrl,
  parseEndpoint,
} from '../src/adapters/endpoint.js'

function endpoint(input: string): Endpoint {
  const result = parseEndpoint(input)
  if (!result.ok) {
    throw new Error(`expected ${input} to parse, got ${result.problem}`)
  }
  return result.endpoint
}

describe('parseEndpoint: the API root', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com/v1'],
    ['https://api.example.com/', 'https://api.example.com/v1'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1'],
    ['https://api.example.com/v1///', 'https://api.example.com/v1'],
    ['https://api.example.com/api/anthropic', 'https://api.example.com/api/anthropic/v1'],
    ['https://api.example.com/openai/v1', 'https://api.example.com/openai/v1'],
    ['https://api.example.com/v2', 'https://api.example.com/v2'],
    ['https://api.example.com/v1beta', 'https://api.example.com/v1beta'],
    ['https://api.example.com/v1alpha2', 'https://api.example.com/v1alpha2'],
  ])('reduces %s to %s', (input, root) => {
    expect(endpoint(input).root).toBe(root)
  })

  it('does not treat a segment that only looks like a version as one', () => {
    expect(endpoint('https://api.example.com/V1').root).toBe('https://api.example.com/V1/v1')
    expect(endpoint('https://api.example.com/v1x').root).toBe('https://api.example.com/v1x/v1')
  })

  it('normalises the origin the way the URL parser does', () => {
    expect(endpoint('HTTPS://API.Example.COM:443/v1').root).toBe('https://api.example.com/v1')
    expect(endpoint('http://example.com:8080').root).toBe('http://example.com:8080/v1')
    expect(endpoint('http://[::1]:3000/v1').root).toBe('http://[::1]:3000/v1')
  })

  it('keeps an empty segment inside the path, which is part of the URL the buyer gave', () => {
    expect(endpoint('https://api.example.com/a//v1').root).toBe('https://api.example.com/a//v1')
  })

  it('drops a fragment, which never reaches the wire', () => {
    expect(endpoint('https://api.example.com/v1#docs').root).toBe('https://api.example.com/v1')
  })

  it('trims whitespace a paste carried along', () => {
    expect(endpoint('  https://api.example.com/v1\n').root).toBe('https://api.example.com/v1')
  })
})

describe('parseEndpoint: a pasted operation URL', () => {
  it.each([
    ['https://h.example/v1/messages', 'https://h.example/v1', 'anthropic-messages'],
    ['https://h.example/v1/messages/', 'https://h.example/v1', 'anthropic-messages'],
    ['https://h.example/v1/messages/count_tokens', 'https://h.example/v1', 'anthropic-messages'],
    ['https://h.example/v1/chat/completions', 'https://h.example/v1', 'openai-chat'],
    ['https://h.example/v1/responses', 'https://h.example/v1', 'openai-responses'],
    ['https://h.example/v1/models', 'https://h.example/v1', undefined],
  ] as const)('reads %s as root %s with hint %s', (input, root, hint) => {
    expect(endpoint(input)).toEqual({ root, protocolHint: hint })
  })

  it('takes the prefix of a pasted operation as the root even without a version segment', () => {
    expect(endpoint('https://h.example/v1beta/openai/chat/completions')).toEqual({
      root: 'https://h.example/v1beta/openai',
      protocolHint: 'openai-chat',
    })
    expect(endpoint('https://h.example/chat/completions').root).toBe('https://h.example')
  })

  it('matches operation segments exactly, not by substring or case', () => {
    expect(endpoint('https://h.example/v1/my-messages').root).toBe(
      'https://h.example/v1/my-messages/v1',
    )
    expect(endpoint('https://h.example/v1/Messages').protocolHint).toBeUndefined()
    expect(endpoint('https://h.example/v1/completions').protocolHint).toBeUndefined()
  })

  it('reports no hint for a bare root', () => {
    expect(endpoint('https://h.example/v1').protocolHint).toBeUndefined()
  })

  it('freezes the result', () => {
    const result = parseEndpoint('https://h.example/v1')
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.ok && Object.isFrozen(result.endpoint)).toBe(true)
  })
})

describe('parseEndpoint: refusals', () => {
  it.each([
    ['', 'not-a-url'],
    ['   ', 'not-a-url'],
    ['api.example.com/v1', 'not-a-url'],
    ['http://', 'not-a-url'],
    ['ftp://example.com/v1', 'unsupported-scheme'],
    ['file:///etc/passwd', 'unsupported-scheme'],
    ['javascript:alert(1)', 'unsupported-scheme'],
    ['https://user:pass@example.com/v1', 'embedded-credentials'],
    ['https://user@example.com/v1', 'embedded-credentials'],
    ['https://example.com/v1?key=abc', 'query-string'],
    ['https://example.com/v1?api-version=2024-10-21', 'query-string'],
  ] as const)('refuses %j as %s', (input, problem) => {
    expect(parseEndpoint(input)).toEqual({ ok: false, problem })
  })

  it('refuses an input longer than the limit without parsing it', () => {
    const long = `https://example.com/${'a'.repeat(MAX_ENDPOINT_LENGTH)}`
    expect(parseEndpoint(long)).toEqual({ ok: false, problem: 'too-long' })
  })

  it('never echoes the input in a refusal', () => {
    const result = parseEndpoint('https://alice:hunter2@example.com/v1')
    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(JSON.stringify(result)).not.toContain('alice')
  })

  it('names every problem it can return', () => {
    expect(ENDPOINT_PROBLEMS.values).toEqual([
      'not-a-url',
      'too-long',
      'unsupported-scheme',
      'embedded-credentials',
      'query-string',
    ])
  })
})

describe('operationUrl and modelPath', () => {
  const root = endpoint('https://h.example/v1')

  it('joins an operation under the root', () => {
    expect(operationUrl(root, 'messages')).toBe('https://h.example/v1/messages')
    expect(operationUrl(root, 'chat/completions')).toBe('https://h.example/v1/chat/completions')
  })

  it('percent-encodes a model id so it stays one path segment', () => {
    expect(modelPath('claude-opus-5-5')).toBe('models/claude-opus-5-5')
    expect(modelPath('anthropic/claude-opus-5')).toBe('models/anthropic%2Fclaude-opus-5')
    expect(modelPath('../../admin')).toBe('models/..%2F..%2Fadmin')
    expect(modelPath('a?b#c d')).toBe('models/a%3Fb%23c%20d')
  })

  it('refuses a model id that would resolve to the collection or its parent', () => {
    expect(() => modelPath('')).toThrow(TypeError)
    expect(() => modelPath('.')).toThrow(TypeError)
    expect(() => modelPath('..')).toThrow(TypeError)
  })
})
