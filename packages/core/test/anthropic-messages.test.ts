import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_STOP_REASONS,
  ANTHROPIC_VERSION,
  anthropicMessages,
} from '../src/adapters/anthropic-messages.js'
import { fixture, patched, REMOVED } from './fixtures/load.js'

const documented = () => fixture('anthropic-messages.documented.json')
const read = (body: unknown) => anthropicMessages.readGeneration(body)
const deviationsOf = (body: unknown) => read(body)?.deviations

describe('anthropicMessages.readGeneration', () => {
  it("reads Anthropic's documented example without a deviation", () => {
    expect(read(documented())).toEqual({
      protocol: 'anthropic-messages',
      id: 'msg_013Zva2CMHLNnXjNJJKqJ2EF',
      model: 'claude-opus-5',
      text: 'Hi! My name is Claude.',
      stopReason: 'end_turn',
      usage: {
        input: 2095,
        output: 503,
        total: undefined,
        cacheRead: 2051,
        cacheCreation: 2051,
        reasoning: 0,
      },
      reasoning: [],
      systemFingerprint: undefined,
      serviceTier: 'standard',
      deviations: [],
    })
  })

  it('joins text blocks in order and reads thinking blocks as reasoning', () => {
    const body = patched(documented(), 'content', [
      { type: 'thinking', thinking: '', signature: 'EqQBCkYIBRgCIkD' },
      { type: 'redacted_thinking', data: 'EmwKAhgBEgy3va3pzix' },
      { type: 'text', text: 'Hello, ' },
      { type: 'tool_use', id: 'toolu_01A09q90qw90lq917835lq9', name: 'get', input: {} },
      { type: 'text', text: 'world' },
    ])
    const generation = read(body)
    expect(generation?.text).toBe('Hello, world')
    expect(generation?.reasoning).toEqual([
      { kind: 'thinking', text: '', signature: 'EqQBCkYIBRgCIkD' },
      { kind: 'redacted-thinking', data: 'EmwKAhgBEgy3va3pzix' },
    ])
    expect(generation?.deviations).toEqual([])
  })

  it('has no text when the response has no text block', () => {
    expect(read(patched(documented(), 'content', []))?.text).toBeUndefined()
  })

  it('lets a block type it does not know pass', () => {
    const body = patched(documented(), 'content', [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} },
      JSON.parse('{"type":"web_search_tool_result","tool_use_id":"srvtoolu_1","content":[]}'),
    ])
    expect(deviationsOf(body)).toEqual([])
  })

  it('accepts every documented stop reason, and reports null or an unknown one', () => {
    for (const reason of ANTHROPIC_STOP_REASONS.values) {
      expect(deviationsOf(patched(documented(), 'stop_reason', reason)), reason).toEqual([])
    }
    expect(deviationsOf(patched(documented(), 'stop_reason', null))).toMatchObject([
      { path: 'stop_reason', received: 'null' },
    ])
    expect(deviationsOf(patched(documented(), 'stop_reason', 'stop'))).toMatchObject([
      { path: 'stop_reason', received: '"stop"' },
    ])
  })

  it('reports what strays from the documented shape', () => {
    let body = patched(documented(), 'type', 'chat.completion')
    body = patched(body, 'role', REMOVED)
    body = patched(body, 'usage.input_tokens', -1)
    body = patched(body, 'usage.cache_read_input_tokens', null)
    body = patched(body, 'content', [
      { type: 'thinking', thinking: 'x' },
      { type: 'tool_use', id: 'call abc', name: 'get', input: {} },
    ])
    expect(deviationsOf(body)).toEqual([
      { path: 'type', expected: '"message"', received: '"chat.completion"' },
      { path: 'role', expected: 'present', received: 'absent' },
      { path: 'content.0.signature', expected: 'present', received: 'absent' },
      { path: 'content.1.id', expected: '/^[a-zA-Z0-9_-]+$/', received: '"call abc"' },
      { path: 'usage.input_tokens', expected: '>=0', received: '-1' },
    ])
    expect(read(body)?.usage?.cacheRead).toBeUndefined()
  })

  it('reads a body with content but no type, and says what is missing', () => {
    const body = patched(patched(documented(), 'type', REMOVED), 'usage', REMOVED)
    const generation = read(body)
    expect(generation?.usage).toBeUndefined()
    expect(generation?.serviceTier).toBeUndefined()
    expect(generation?.deviations).toEqual([
      { path: 'type', expected: 'present', received: 'absent' },
      { path: 'usage', expected: 'present', received: 'absent' },
    ])
  })

  it('does not read what is not a Messages response', () => {
    for (const body of [
      JSON.parse('{"type":"error","error":{"type":"api_error","message":"m"}}'),
      JSON.parse('{"object":"chat.completion","choices":[]}'),
      JSON.parse('{"content":"text"}'),
      [],
      null,
      'message',
    ]) {
      expect(read(body)).toBeUndefined()
    }
  })

  it('freezes what it returns', () => {
    const generation = read(documented())
    expect(Object.isFrozen(generation)).toBe(true)
    expect(Object.isFrozen(generation?.usage)).toBe(true)
    expect(Object.isFrozen(generation?.reasoning)).toBe(true)
  })
})

describe('anthropicMessages.headers', () => {
  const apiKey = 'test-key-0000'

  it('sends the version, the key in x-api-key by default, and a content type with a body', () => {
    expect(anthropicMessages.authSchemes[0]).toBe('x-api-key')
    expect(anthropicMessages.headers({ apiKey, auth: 'x-api-key', hasBody: true })).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
      ['anthropic-version', ANTHROPIC_VERSION],
      ['X-Api-Key', apiKey],
    ])
  })

  it('sends the key as a bearer token when asked', () => {
    expect(anthropicMessages.headers({ apiKey, auth: 'bearer', hasBody: false })).toEqual([
      ['Accept', 'application/json'],
      ['anthropic-version', ANTHROPIC_VERSION],
      ['Authorization', `Bearer ${apiKey}`],
    ])
  })

  it('sends no credential when there is no key', () => {
    expect(
      anthropicMessages.headers({ apiKey: undefined, auth: 'x-api-key', hasBody: false }),
    ).toEqual([
      ['Accept', 'application/json'],
      ['anthropic-version', ANTHROPIC_VERSION],
    ])
  })

  it('freezes the headers', () => {
    const headers = anthropicMessages.headers({ apiKey, auth: 'x-api-key', hasBody: true })
    expect(Object.isFrozen(headers)).toBe(true)
    expect(headers.every((pair) => Object.isFrozen(pair))).toBe(true)
  })
})
