import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openaiResponses, RESPONSE_STATUSES } from '../src/adapters/openai-responses.js'
import { fixture, patched, REMOVED } from './fixtures/load.js'

const documented = () => fixture('openai-responses.documented.json')
const read = (body: unknown) => openaiResponses.readGeneration(body)
const deviationsOf = (body: unknown) => read(body)?.deviations
const examples = readdirSync(new URL('./fixtures/', import.meta.url)).filter((name) =>
  name.startsWith('openai-responses.documented'),
)

const STORY =
  'In a peaceful grove beneath a silver moon, a unicorn named Lumina discovered a hidden pool that reflected the stars. As she dipped her horn into the water, the pool began to shimmer, revealing a pathway to a magical realm of endless night skies. Filled with wonder, Lumina whispered a wish for all who dream to find their own hidden magic, and as she glanced back, her hoofprints sparkled like stardust.'

const message = (id: string, content: readonly unknown[]) => ({
  type: 'message',
  id,
  status: 'completed',
  role: 'assistant',
  content,
})
const outputText = (text: string) => ({ type: 'output_text', text, annotations: [] })

describe('openaiResponses.readGeneration', () => {
  it.each(examples)('reads the documented example %s without a deviation', (name) => {
    expect(deviationsOf(fixture(name))).toEqual([])
  })

  it('reads the documented Text input example', () => {
    expect(read(documented())).toEqual({
      protocol: 'openai-responses',
      id: 'resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b',
      model: 'gpt-6-astra',
      text: STORY,
      stopReason: 'completed',
      usage: { input: 36, output: 87, total: 123, cacheRead: 0, cacheCreation: 0, reasoning: 0 },
      reasoning: [],
      systemFingerprint: undefined,
      serviceTier: undefined,
      deviations: [],
    })
  })

  it('reads the reasoning token count of the Reasoning example', () => {
    const generation = read(fixture('openai-responses.documented-reasoning.json'))
    expect(generation?.usage?.reasoning).toBe(832)
    expect(generation?.reasoning).toEqual([])
  })

  it('reads the service tier of the File input example', () => {
    expect(read(fixture('openai-responses.documented-file-input.json'))?.serviceTier).toBe(
      'default',
    )
  })

  it('has no text when the output is only a function call', () => {
    const generation = read(fixture('openai-responses.documented-functions.json'))
    expect(generation?.text).toBeUndefined()
    expect(generation?.usage?.cacheRead).toBeUndefined()
  })

  it('joins the text of every message item, and leaves refusals out', () => {
    const body = patched(documented(), 'output', [
      message('msg_1', [outputText('One. '), { type: 'refusal', refusal: 'No.' }]),
      JSON.parse('{"type":"web_search_call","id":"ws_1","status":"completed"}'),
      message('msg_2', [outputText('Two.')]),
    ])
    expect(read(body)?.text).toBe('One. Two.')
    expect(read(body)?.deviations).toEqual([])
  })

  it('reads reasoning items with their summary and encrypted content', () => {
    const body = patched(documented(), 'output', [
      JSON.parse(
        '{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"Plan."}],"encrypted_content":"gAAAAABo"}',
      ),
      JSON.parse('{"type":"reasoning","id":"rs_2","summary":[]}'),
      message('msg_1', [outputText('Done.')]),
    ])
    expect(read(body)?.reasoning).toEqual([
      { kind: 'reasoning', id: 'rs_1', summary: ['Plan.'], encryptedContent: 'gAAAAABo' },
      { kind: 'reasoning', id: 'rs_2', summary: [], encryptedContent: undefined },
    ])
    expect(read(body)?.deviations).toEqual([])
  })

  it('gives the incomplete reason as the stop reason when there is one', () => {
    let body = patched(documented(), 'status', 'incomplete')
    body = patched(body, 'incomplete_details', { reason: 'max_output_tokens' })
    expect(read(body)?.stopReason).toBe('max_output_tokens')
    expect(read(body)?.deviations).toEqual([])
    expect(read(patched(documented(), 'status', REMOVED))?.stopReason).toBeUndefined()
  })

  it('accepts every documented status', () => {
    for (const status of RESPONSE_STATUSES.values) {
      expect(deviationsOf(patched(documented(), 'status', status))).toEqual([])
    }
  })

  it('reports what strays from the documented shape', () => {
    let body = patched(documented(), 'created_at', '1741476542')
    body = patched(body, 'error', { message: 'failed' })
    body = patched(body, 'output.0.status', 'done')
    body = patched(body, 'output.0.content.0.annotations', REMOVED)
    body = patched(body, 'access_programs', REMOVED)
    body = patched(body, 'parallel_tool_calls', 'yes')
    body = patched(body, 'usage.output_tokens', -87)
    body = patched(body, 'service_tier', 'standard')
    expect(deviationsOf(body)?.map(({ path }) => path)).toEqual([
      'created_at',
      'error.code',
      'output.0.status',
      'output.0.content.0.annotations',
      'access_programs',
      'parallel_tool_calls',
      'usage.output_tokens',
      'service_tier',
    ])
  })

  it('reports a malformed reasoning summary and function call', () => {
    const body = patched(documented(), 'output', [
      JSON.parse('{"type":"reasoning","id":"rs_1","summary":[{"type":"text","text":"x"}]}'),
      JSON.parse('{"type":"function_call","name":"get","arguments":"{}"}'),
    ])
    expect(deviationsOf(body)).toEqual([
      { path: 'output.0.summary.0.type', expected: '"summary_text"', received: '"text"' },
      { path: 'output.1.call_id', expected: 'present', received: 'absent' },
    ])
    expect(read(body)?.reasoning).toEqual([
      { kind: 'reasoning', id: 'rs_1', summary: [], encryptedContent: undefined },
    ])
  })

  it('does not read what is not a Responses response', () => {
    for (const body of [
      fixture('anthropic-messages.documented.json'),
      fixture('openai-chat.documented.json'),
      JSON.parse(
        '{"error":{"message":"m","type":"invalid_request_error","param":null,"code":null}}',
      ),
      JSON.parse('{"output":"text"}'),
      [],
      null,
    ]) {
      expect(read(body)).toBeUndefined()
    }
  })

  it('freezes what it returns', () => {
    const body = patched(documented(), 'output', [
      JSON.parse('{"type":"reasoning","id":"rs_1","summary":[]}'),
    ])
    const generation = read(body)
    expect(Object.isFrozen(generation)).toBe(true)
    expect(Object.isFrozen(generation?.usage)).toBe(true)
    expect(Object.isFrozen(generation?.reasoning)).toBe(true)
    const [item] = generation?.reasoning ?? []
    expect(Object.isFrozen(item)).toBe(true)
    expect(item?.kind === 'reasoning' && Object.isFrozen(item.summary)).toBe(true)
  })
})

describe('openaiResponses.headers', () => {
  it('matches Chat Completions: a content type with a body, JSON accepted, then a bearer token', () => {
    expect(openaiResponses.authSchemes).toEqual(['bearer'])
    expect(openaiResponses.headers({ apiKey: 'k-0000', auth: 'bearer', hasBody: true })).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
      ['Authorization', 'Bearer k-0000'],
    ])
  })
})
