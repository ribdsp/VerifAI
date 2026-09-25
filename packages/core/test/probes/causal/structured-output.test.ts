import { describe, expect, it } from 'vitest'
import { structuredOutput } from '../../../src/probes/causal/structured-output.js'
import type { Exchange } from '../../../src/probes/types.js'
import { ProbeLost } from '../../../src/runner/errors.js'
import {
  ANTHROPIC_STRUCTURED_CAPITALIZATION,
  ANTHROPIC_STRUCTURED_JSON_OUTPUTS,
} from '../../../src/sources/anthropic-causal.js'
import { OPENAI_STRUCTURED_ADHERES } from '../../../src/sources/openai-causal.js'
import type { Protocol } from '../../../src/types/target.js'
import { exchange, inOrder, probeContext, probeTarget } from '../../fakes/context.js'
import { bodyOf, chat, message, responsesReply, withinCost } from './replies.js'

const NONCE = 'n0nce7test'
const WORDS = [`tide-${NONCE}`, `reef-${NONCE}`]
const CONFORMING = `{"word":"tide-${NONCE}","count":3}`
const PROSE = 'The sea glittered under a pale morning sun.'

const MODELS: Readonly<Record<Protocol, string>> = Object.freeze({
  'anthropic-messages': 'claude-opus-5-5',
  'openai-chat': 'gpt-4o',
  'openai-responses': 'gpt-5',
})

function reply(protocol: Protocol, text: string): Exchange {
  switch (protocol) {
    case 'anthropic-messages':
      return message({ content: [{ type: 'text', text }] })
    case 'openai-chat':
      return chat(text)
    case 'openai-responses':
      return responsesReply(text)
  }
}

async function runWith(protocol: Protocol, answer: Exchange) {
  const fake = probeContext(inOrder(answer), { protocol, model: MODELS[protocol] })
  const signals = await structuredOutput.run(fake.context)
  expect(fake.requests).toHaveLength(1)
  expect(withinCost(structuredOutput, fake)).toBe(true)
  return { fake, signals }
}

/** The schema a request carries, wherever its protocol puts it. */
function schemaOf(protocol: Protocol, body: Record<string, unknown>): unknown {
  const path: Readonly<Record<Protocol, readonly string[]>> = {
    'anthropic-messages': ['output_config', 'format', 'schema'],
    'openai-chat': ['response_format', 'json_schema', 'schema'],
    'openai-responses': ['text', 'format', 'schema'],
  }
  return path[protocol].reduce<unknown>(
    (value, key) => (value as Record<string, unknown> | undefined)?.[key],
    body,
  )
}

describe('causal/structured-output', () => {
  it.each([
    ['anthropic-messages', 'documented'],
    ['openai-chat', 'derived'],
    ['openai-responses', 'derived'],
  ] as const)('finds the schema enforced over %s', async (protocol, calibration) => {
    const { fake, signals } = await runWith(protocol, reply(protocol, CONFORMING))

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      probeId: 'causal/structured-output',
      signalId: 'schema-enforced',
      calibration,
      llr: { identity: { 'matches-claim': 0.1, 'not-a-live-model': -0.5 } },
    })
    expect(schemaOf(protocol, bodyOf(fake.requests[0]))).toMatchObject({
      properties: { word: { enum: WORDS }, count: { type: 'integer' } },
      required: ['word', 'count'],
      additionalProperties: false,
    })
  })

  it('marks the OpenAI schemas strict and names them', async () => {
    const chatRun = await runWith('openai-chat', reply('openai-chat', CONFORMING))
    const responsesRun = await runWith('openai-responses', reply('openai-responses', CONFORMING))

    expect(bodyOf(chatRun.fake.requests[0])).toMatchObject({
      // biome-ignore lint/style/useNamingConvention: OpenAI's wire names.
      response_format: { type: 'json_schema', json_schema: { name: 'sea_note', strict: true } },
    })
    expect(bodyOf(responsesRun.fake.requests[0])).toMatchObject({
      text: { format: { type: 'json_schema', name: 'sea_note', strict: true } },
    })
    expect(chatRun.signals[0]?.citations).toContain(OPENAI_STRUCTURED_ADHERES)
  })

  it('accepts an enum value whose capitalization changed', async () => {
    const { signals } = await runWith(
      'anthropic-messages',
      reply('anthropic-messages', ` {"count":-2,"word":"Reef-${NONCE.toUpperCase()}"}\n`),
    )

    expect(signals[0]?.signalId).toBe('schema-enforced')
    expect(signals[0]?.citations).toEqual(
      expect.arrayContaining([
        ANTHROPIC_STRUCTURED_JSON_OUTPUTS,
        ANTHROPIC_STRUCTURED_CAPITALIZATION,
      ]),
    )
  })

  it.each([
    ['prose', PROSE],
    ['an array', `[${CONFORMING}]`],
    ['null', 'null'],
    ['an extra key', `{"word":"tide-${NONCE}","count":3,"note":"x"}`],
    ['a missing key', `{"word":"tide-${NONCE}"}`],
    ['a word outside the enum', '{"word":"tide","count":3}'],
    ['a fractional count', `{"word":"tide-${NONCE}","count":2.5}`],
    ['a string count', `{"word":"tide-${NONCE}","count":"3"}`],
  ])('reads %s under the schema as the schema not enforced', async (_label, text) => {
    const { signals } = await runWith('anthropic-messages', reply('anthropic-messages', text))

    expect(signals[0]).toMatchObject({
      signalId: 'schema-ignored',
      llr: { translation: { translated: 0.7 } },
    })
    expect(signals[0]?.llr.identity).toBeUndefined()
  })

  it.each([
    [
      'a response cut off by its limit',
      message({ stop: 'max_tokens', content: [{ type: 'text', text: PROSE }] }),
    ],
    ['a refusal', message({ stop: 'refusal', content: [{ type: 'text', text: PROSE }] })],
    ['an empty answer', message({ content: [{ type: 'text', text: '  ' }] })],
    ['a failed request', exchange(400, 'bad request')],
  ])('judges nothing from %s', async (_label, answer) => {
    const { signals } = await runWith('anthropic-messages', answer)

    expect(signals).toEqual([])
  })

  it('judges nothing from an incomplete Responses answer', async () => {
    const { signals } = await runWith('openai-responses', responsesReply(PROSE, 'incomplete'))

    expect(signals).toEqual([])
  })

  it('lets runner errors through', async () => {
    const fake = probeContext(inOrder(new ProbeLost()))

    await expect(structuredOutput.run(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })

  it.each([
    ['anthropic-messages', 'anthropic', 'claude-opus-5-5', true],
    ['anthropic-messages', 'anthropic', 'claude-unknown-9', false],
    ['openai-chat', 'openai', 'gpt-4o', true],
    ['openai-chat', 'openai', 'gpt-4o-2024-08-06', true],
    ['openai-chat', 'openai', 'gpt-4o-2024-05-13', false],
    ['openai-chat', 'openai', 'gpt-4o-mini', true],
    ['openai-chat', 'openai', 'gpt-4o-audio-preview', false],
    ['openai-responses', 'openai', 'o3', true],
    ['openai-chat', 'openai', 'o1-mini', false],
    ['openai-chat', 'openai', 'gpt-3.5-turbo', false],
    ['openai-chat', 'anthropic', 'claude-opus-5-5', false],
  ] as const)('applies over %s to a %s claim of %s: %s', (protocol, vendor, model, expected) => {
    expect(structuredOutput.applies?.(probeTarget({ protocol, vendor, model }))).toBe(expected)
  })
})
