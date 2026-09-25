import { describe, expect, it } from 'vitest'
import { idFormat } from '../../../src/probes/accounting/id-format.js'
import { ProbeNotApplicable } from '../../../src/runner/errors.js'
import { ANTHROPIC_MESSAGE_ID_EXAMPLE } from '../../../src/sources/anthropic-accounting.js'
import {
  OPENAI_CHAT_ID_EXAMPLE,
  OPENAI_RESPONSES_ID_EXAMPLE,
} from '../../../src/sources/openai-accounting.js'
import type { Protocol } from '../../../src/types/target.js'
import { inOrder, probeContext } from '../../fakes/context.js'
import { OMIT, reply } from './replies.js'

async function runWith(protocol: Protocol, id?: string | typeof OMIT) {
  const fake = probeContext(inOrder(reply(protocol, id === undefined ? {} : { id })), {
    protocol,
  })
  const signals = await idFormat.run(fake.context)
  expect(signals).toHaveLength(1)
  const [found] = signals
  expect(found?.calibration).toBe('heuristic')
  return found
}

describe('accounting/id-format', () => {
  it('does not apply to Anthropic Messages, whose ID format may change', async () => {
    const fake = probeContext(inOrder(reply('anthropic-messages')))

    await expect(idFormat.run(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
    expect(fake.requests).toHaveLength(0)
    expect(idFormat.protocols).toEqual(['openai-chat', 'openai-responses'])
  })

  it.each([
    ['openai-chat', OPENAI_CHAT_ID_EXAMPLE],
    ['openai-responses', OPENAI_RESPONSES_ID_EXAMPLE],
  ] as const)('accepts a %s ID shaped like the published example', async (protocol, example) => {
    const found = await runWith(protocol)

    expect(found).toMatchObject({ signalId: 'openai-shaped', llr: {}, citations: [example] })
  })

  it.each([
    ['openai-chat', OMIT, 'missing', { translation: { translated: 0.3 } }],
    [
      'openai-chat',
      'msg_013Zva2CMHLNnXjNJJKqJ2EF',
      'anthropic-shaped',
      { identity: { 'different-vendor': 0.3 }, translation: { translated: 0.3 } },
    ],
    [
      'openai-chat',
      'gen-1758000000-AbCdEfGhIjKlMnOp',
      'foreign-prefix',
      { translation: { translated: 0.3 } },
    ],
    ['openai-chat', 'chatcmpl-8f2c1d', 'foreign-shape', { translation: { translated: 0.2 } }],
    [
      'openai-responses',
      'chatcmpl-B9MHDbslfkBeAs8l4bebGdFOJ6PeG',
      'foreign-prefix',
      { translation: { translated: 0.3 } },
    ],
    [
      'openai-responses',
      `resp_${'0a'.repeat(25)}`,
      'foreign-shape',
      { translation: { translated: 0.2 } },
    ],
    [
      'openai-responses',
      `resp_${'0A'.repeat(24)}`,
      'foreign-shape',
      { translation: { translated: 0.2 } },
    ],
  ] as const)('reads a %s ID of %s as %s', async (protocol, id, signalId, llr) => {
    const found = await runWith(protocol, id)

    expect(found).toMatchObject({ signalId, llr })
  })

  it("cites Anthropic's example beside OpenAI's for a msg_ ID", async () => {
    const found = await runWith('openai-responses', 'msg_013Zva2CMHLNnXjNJJKqJ2EF')

    expect(found?.citations).toEqual([OPENAI_RESPONSES_ID_EXAMPLE, ANTHROPIC_MESSAGE_ID_EXAMPLE])
    expect(found?.observed).toContain('"msg_013Zva2CMHLNnXjNJJKqJ2EF"')
  })

  it('says when there is no ID', async () => {
    const found = await runWith('openai-chat', OMIT)

    expect(found?.observed).toBe('The response had no id.')
  })
})
