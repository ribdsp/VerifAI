import { describe, expect, it } from 'vitest'
import { protocolLeakage } from '../../../../src/probes/conformance/common/protocol-leakage.js'
import type { Exchange } from '../../../../src/probes/types.js'
import { ANTHROPIC_MESSAGE_TYPE } from '../../../../src/sources/anthropic-conformance-common.js'
import {
  OPENAI_CHAT_COMPLETION_OBJECT,
  OPENAI_RESPONSE_OBJECT,
  OPENAI_SYSTEM_FINGERPRINT,
} from '../../../../src/sources/openai-conformance.js'
import type { Protocol } from '../../../../src/types/target.js'
import { exchange, inOrder, probeContext, probeTarget } from '../../../fakes/context.js'
import { jsonText } from '../openai/edge.js'

const CLEAN_MESSAGE =
  '{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"OK"}],"stop_reason":"max_tokens"}'
const CLEAN_CHAT =
  '{"id":"chatcmpl-1","object":"chat.completion","system_fingerprint":"fp_1","choices":[]}'
const CLEAN_RESPONSE = '{"id":"resp_1","object":"response","status":"incomplete","output":[]}'

async function runWith(answer: Exchange, protocol: Protocol) {
  const fake = probeContext(inOrder(answer), { protocol })
  const signals = await protocolLeakage.run(fake.context)
  return { signals, requests: fake.requests }
}

describe('conformance/common/protocol-leakage', () => {
  it('asks native pairings only', () => {
    expect(protocolLeakage.applies?.(probeTarget({ protocol: 'openai-chat' }))).toBe(true)
    expect(
      protocolLeakage.applies?.(probeTarget({ protocol: 'openai-chat', vendor: 'anthropic' })),
    ).toBe(false)
  })

  it('sends one tiny generation in the target protocol', async () => {
    const { requests } = await runWith(exchange(500), 'openai-responses')

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: 'responses', generates: true })
    expect(requests[0]?.tokens).toBeLessThanOrEqual(protocolLeakage.cost.tokens)
  })

  it("finds OpenAI's fields in a Messages answer, citing each", async () => {
    const { signals } = await runWith(
      jsonText(200, '{"type":"message","object":"chat.completion","system_fingerprint":null}'),
      'anthropic-messages',
    )

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'foreign-markers',
      calibration: 'documented',
      llr: {
        platform: { 'first-party': -0.5 },
        translation: { translated: 0.8, direct: -0.5 },
      },
      citations: [OPENAI_CHAT_COMPLETION_OBJECT, OPENAI_SYSTEM_FINGERPRINT],
    })
    expect(signals[0]?.llr.identity).toBeUndefined()
    expect(signals[0]?.observed).toBe(
      'A successful anthropic-messages answer carries "object": "chat.completion", a "system_fingerprint" field.',
    )
  })

  it.each([
    ['openai-chat', '{"type":"message","choices":[]}', ANTHROPIC_MESSAGE_TYPE],
    ['openai-chat', '{"object":"response"}', OPENAI_CHAT_COMPLETION_OBJECT],
    ['openai-responses', '{"object":"chat.completion"}', OPENAI_RESPONSE_OBJECT],
    ['openai-responses', '{"type":"message","object":"response"}', ANTHROPIC_MESSAGE_TYPE],
    ['anthropic-messages', '{"object":"response"}', OPENAI_RESPONSE_OBJECT],
  ] as const)('finds a foreign marker in a %s answer %s', async (protocol, text, citation) => {
    const { signals } = await runWith(jsonText(200, text), protocol)

    expect(signals.map((found) => found.signalId)).toEqual(['foreign-markers'])
    expect(signals[0]?.citations).toEqual([citation])
  })

  it.each([
    ['anthropic-messages', CLEAN_MESSAGE],
    ['openai-chat', CLEAN_CHAT],
    ['openai-responses', CLEAN_RESPONSE],
  ] as const)('says nothing about a clean %s answer', async (protocol, text) => {
    expect((await runWith(jsonText(200, text), protocol)).signals).toEqual([])
  })

  it('says nothing about a refusal, a non-JSON answer or a JSON array', async () => {
    const refused = await runWith(
      jsonText(400, '{"object":"chat.completion"}'),
      'anthropic-messages',
    )
    const text = await runWith(exchange(200, 'OK'), 'openai-chat')
    const array = await runWith(jsonText(200, '[{"type":"message"}]'), 'openai-chat')

    expect(refused.signals).toEqual([])
    expect(text.signals).toEqual([])
    expect(array.signals).toEqual([])
  })
})
