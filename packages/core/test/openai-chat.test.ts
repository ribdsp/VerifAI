import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHAT_FINISH_REASONS, openaiChat } from '../src/adapters/openai-chat.js'
import { fixture, patched, REMOVED } from './fixtures/load.js'

const documented = () => fixture('openai-chat.documented.json')
const read = (body: unknown) => openaiChat.readGeneration(body)
const deviationsOf = (body: unknown) => read(body)?.deviations
const examples = readdirSync(new URL('./fixtures/', import.meta.url)).filter((name) =>
  name.startsWith('openai-chat.documented'),
)

describe('openaiChat.readGeneration', () => {
  it.each(examples)('reads the documented example %s without a deviation', (name) => {
    expect(deviationsOf(fixture(name))).toEqual([])
  })

  it('reads the documented Default example', () => {
    expect(read(documented())).toEqual({
      protocol: 'openai-chat',
      id: 'chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT',
      model: 'gpt-6-astra',
      text: 'Hello! How can I assist you today?',
      stopReason: 'stop',
      usage: {
        input: 19,
        output: 10,
        total: 29,
        cacheRead: 0,
        cacheCreation: undefined,
        reasoning: 0,
      },
      reasoning: [],
      systemFingerprint: undefined,
      serviceTier: 'default',
      deviations: [],
    })
  })

  it('reads a tool call response as having no text and no cache detail', () => {
    const generation = read(fixture('openai-chat.documented-functions.json'))
    expect(generation?.text).toBeUndefined()
    expect(generation?.stopReason).toBe('tool_calls')
    expect(generation?.usage).toMatchObject({ total: 99, cacheRead: undefined, reasoning: 0 })
    expect(generation?.serviceTier).toBeUndefined()
  })

  it('tells a null system fingerprint from an absent one', () => {
    expect(read(fixture('openai-chat.documented-logprobs.json'))?.systemFingerprint).toBeNull()
    expect(read(documented())?.systemFingerprint).toBeUndefined()
    expect(
      read(patched(documented(), 'system_fingerprint', 'fp_3ac22ab6ab'))?.systemFingerprint,
    ).toBe('fp_3ac22ab6ab')
  })

  it('reads the reasoning fields other servers add to the message', () => {
    let body = patched(documented(), 'choices.0.message.reasoning_content', 'Thinking first.')
    body = patched(body, 'choices.0.message.reasoning', 'And again.')
    expect(read(body)?.reasoning).toEqual([
      { kind: 'reasoning-content', field: 'reasoning_content', text: 'Thinking first.' },
      { kind: 'reasoning-content', field: 'reasoning', text: 'And again.' },
    ])
    expect(read(body)?.deviations).toEqual([])
  })

  it('ignores a reasoning field that is not text', () => {
    const body = patched(documented(), 'choices.0.message.reasoning', { effort: 'low' })
    expect(read(body)?.reasoning).toEqual([])
  })

  it('accepts every documented finish reason', () => {
    for (const reason of CHAT_FINISH_REASONS.values) {
      expect(deviationsOf(patched(documented(), 'choices.0.finish_reason', reason))).toEqual([])
    }
  })

  it('reports what strays from the documented shape', () => {
    let body = patched(documented(), 'object', 'chat.completion.chunk')
    body = patched(body, 'created', 1741569952.5)
    body = patched(body, 'choices.0.message.role', 'user')
    body = patched(body, 'choices.0.message.content', REMOVED)
    body = patched(body, 'choices.0.message.tool_calls', [{ type: 'function', id: 'call_1' }])
    body = patched(body, 'choices.0.finish_reason', 'end_turn')
    body = patched(body, 'choices.0.logprobs', REMOVED)
    body = patched(body, 'usage.total_tokens', '29')
    body = patched(body, 'system_fingerprint', 5)
    body = patched(body, 'service_tier', 'standard')
    expect(deviationsOf(body)?.map(({ path }) => path)).toEqual([
      'object',
      'created',
      'choices.0.message.role',
      'choices.0.message.content',
      'choices.0.message.tool_calls.0.function',
      'choices.0.finish_reason',
      'choices.0.logprobs',
      'usage.total_tokens',
      'system_fingerprint',
      'service_tier',
    ])
  })

  it('reads what it can when the first choice is not an object', () => {
    const generation = read(patched(documented(), 'choices', ['text']))
    expect(generation?.text).toBeUndefined()
    expect(generation?.stopReason).toBeUndefined()
    expect(generation?.reasoning).toEqual([])
    expect(generation?.deviations).toEqual([
      { path: 'choices.0', expected: 'Object', received: '"text"' },
    ])
  })

  it('reads a body with choices but no object type, and says what is missing', () => {
    const body = patched(patched(documented(), 'object', REMOVED), 'usage', REMOVED)
    expect(read(body)?.usage).toBeUndefined()
    expect(deviationsOf(body)).toEqual([
      { path: 'object', expected: 'present', received: 'absent' },
    ])
  })

  it('does not read what is not a Chat Completions response', () => {
    for (const body of [
      fixture('anthropic-messages.documented.json'),
      fixture('openai-responses.documented.json'),
      JSON.parse(
        '{"error":{"message":"m","type":"invalid_request_error","param":null,"code":null}}',
      ),
      JSON.parse('{"choices":{}}'),
      [],
      null,
    ]) {
      expect(read(body)).toBeUndefined()
    }
  })

  it('freezes what it returns', () => {
    const generation = read(patched(documented(), 'choices.0.message.reasoning', 'r'))
    expect(Object.isFrozen(generation)).toBe(true)
    expect(Object.isFrozen(generation?.usage)).toBe(true)
    expect(Object.isFrozen(generation?.reasoning)).toBe(true)
    expect(Object.isFrozen(generation?.reasoning[0])).toBe(true)
  })
})

describe('openaiChat.headers', () => {
  const apiKey = 'test-key-0000'

  it('sends a content type with a body, then the key as a bearer token', () => {
    expect(openaiChat.authSchemes).toEqual(['bearer'])
    expect(openaiChat.headers({ apiKey, auth: 'bearer', hasBody: true })).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
      ['Authorization', `Bearer ${apiKey}`],
    ])
  })

  it('asks for JSON and sends nothing else without a body or a key', () => {
    expect(openaiChat.headers({ apiKey: undefined, auth: 'bearer', hasBody: false })).toEqual([
      ['Accept', 'application/json'],
    ])
  })

  it('refuses the x-api-key scheme, with or without a key, and never names the key', () => {
    expect(() => openaiChat.headers({ apiKey, auth: 'x-api-key', hasBody: false })).toThrow(
      new TypeError('Auth scheme x-api-key is not one this protocol documents'),
    )
    expect(() =>
      openaiChat.headers({ apiKey: undefined, auth: 'x-api-key', hasBody: false }),
    ).toThrow(TypeError)
  })
})
