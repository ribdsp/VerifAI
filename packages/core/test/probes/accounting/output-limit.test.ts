import { describe, expect, it } from 'vitest'
import { outputLimit } from '../../../src/probes/accounting/output-limit.js'
import {
  ANTHROPIC_MAX_TOKENS_CEILING,
  ANTHROPIC_STOP_MAX_TOKENS,
  ANTHROPIC_STOP_REASON_NON_NULL,
} from '../../../src/sources/anthropic-accounting.js'
import {
  OPENAI_CHAT_LENGTH_FINISH,
  OPENAI_CHAT_MAX_COMPLETION_TOKENS,
  OPENAI_RESPONSES_INCOMPLETE,
  OPENAI_RESPONSES_MAX_OUTPUT_TOKENS,
} from '../../../src/sources/openai-accounting.js'
import type { Protocol } from '../../../src/types/target.js'
import { inOrder, probeContext, sentJson } from '../../fakes/context.js'
import { OMIT, type ReplyFields, refusingOneToken, reply } from './replies.js'

async function runWith(protocol: Protocol, fields: ReplyFields = {}) {
  const fake = probeContext(inOrder(reply(protocol, fields)), { protocol })
  const signals = await outputLimit.run(fake.context)
  expect(signals).toHaveLength(1)
  return { found: signals[0], requests: fake.requests }
}

describe('accounting/output-limit', () => {
  it.each([
    [
      'anthropic-messages',
      'max_tokens',
      1,
      ANTHROPIC_MAX_TOKENS_CEILING,
      ANTHROPIC_STOP_MAX_TOKENS,
    ],
    [
      'openai-chat',
      'max_completion_tokens',
      1,
      OPENAI_CHAT_MAX_COMPLETION_TOKENS,
      OPENAI_CHAT_LENGTH_FINISH,
    ],
    [
      'openai-responses',
      'max_output_tokens',
      16,
      OPENAI_RESPONSES_MAX_OUTPUT_TOKENS,
      OPENAI_RESPONSES_INCOMPLETE,
    ],
  ] as const)(
    'finds a %s answer that stops at the limit it set',
    async (protocol, field, limit, ceiling, stop) => {
      const { found, requests } = await runWith(protocol)

      expect(sentJson(requests[0])).toMatchObject({ [field]: limit })
      expect(found).toMatchObject({
        signalId: 'within-limit',
        family: 'accounting',
        calibration: 'documented',
        llr: {},
        citations: [ceiling, stop],
      })
      expect(found?.observed).toContain(`${field} ${limit}`)
    },
  )

  it('judges the limit the endpoint accepted, and says which smaller one it refused', async () => {
    const fake = probeContext(
      refusingOneToken(
        inOrder(
          reply('openai-chat', {
            usage: '{"prompt_tokens":300,"completion_tokens":16,"total_tokens":316}',
          }),
        ),
      ),
      { protocol: 'openai-chat' },
    )

    const [found] = await outputLimit.run(fake.context)

    expect(found?.signalId).toBe('within-limit')
    expect(found?.observed).toContain(
      'Under max_completion_tokens 16, after the endpoint refused 1 with a 400: completion_tokens 16,',
    )
    expect(found?.expected).toContain('At most 16 in completion_tokens')
  })

  it('reads output past the limit as not generated under the request', async () => {
    const { found } = await runWith('anthropic-messages', {
      usage: '{"input_tokens":312,"output_tokens":40}',
    })

    expect(found).toMatchObject({
      signalId: 'over-limit',
      calibration: 'documented',
      llr: { identity: { 'not-a-live-model': 0.2 }, translation: { translated: 0.5 } },
      citations: [ANTHROPIC_MAX_TOKENS_CEILING],
    })
  })

  it('reads more text than the limit could decode to as over the limit', async () => {
    const { found } = await runWith('openai-chat', { text: 'x'.repeat(193) })

    expect(found?.signalId).toBe('over-limit')
    expect(found?.observed).toContain('193 bytes of text')
  })

  it('allows text up to the generous bound', async () => {
    const { found } = await runWith('openai-chat', { text: 'x'.repeat(192) })

    expect(found?.signalId).toBe('within-limit')
  })

  it.each([
    ['openai-chat', { stop: 'stop' }],
    ['openai-responses', { stop: 'completed' }],
    ['anthropic-messages', { stop: 'end_turn' }],
    ['openai-chat', { stop: 'stop', usage: OMIT }],
  ] as const)(
    'moves only translation when %s reports another stop at the limit',
    async (protocol, fields) => {
      const { found } = await runWith(protocol, fields)

      expect(found).toMatchObject({
        signalId: 'stop-reason',
        calibration: 'documented',
        llr: { translation: { translated: 0.4 } },
      })
      expect(found?.citations).toHaveLength(1)
    },
  )

  it("cites Anthropic's non-null stop_reason when it is null", async () => {
    const { found } = await runWith('anthropic-messages', { stop: null })

    expect(found?.signalId).toBe('stop-reason')
    expect(found?.observed).toContain('stop_reason null')
    expect(found?.citations).toEqual([ANTHROPIC_STOP_MAX_TOKENS, ANTHROPIC_STOP_REASON_NON_NULL])
  })

  it('says when the stop reason is absent', async () => {
    const { found } = await runWith('anthropic-messages', { stop: OMIT })

    expect(found?.signalId).toBe('stop-reason')
    expect(found?.observed).toContain('stop_reason absent')
  })

  it('accepts a natural stop before the limit', async () => {
    const { found } = await runWith('openai-responses', {
      stop: 'completed',
      usage: '{"input_tokens":300,"output_tokens":5,"total_tokens":305}',
    })

    expect(found?.signalId).toBe('within-limit')
  })
})
