import { describe, expect, it } from 'vitest'
import { usageArithmetic } from '../../../src/probes/accounting/usage-arithmetic.js'
import { ProbeLost } from '../../../src/runner/errors.js'
import { ANTHROPIC_USAGE_TOTAL_INPUT } from '../../../src/sources/anthropic.js'
import {
  ANTHROPIC_OUTPUT_NON_ZERO,
  ANTHROPIC_USAGE_BILLING,
} from '../../../src/sources/anthropic-accounting.js'
import { OPENAI_CHAT_TOTAL_TOKENS } from '../../../src/sources/openai.js'
import {
  OPENAI_CHAT_CACHED_TOKENS,
  OPENAI_CHAT_USAGE,
  OPENAI_RESPONSES_OUTPUT_BREAKDOWN,
  OPENAI_RESPONSES_TOTAL_TOKENS,
} from '../../../src/sources/openai-accounting.js'
import type { Protocol } from '../../../src/types/target.js'
import { exchange, inOrder, probeContext } from '../../fakes/context.js'
import { OMIT, reply } from './replies.js'

async function runWith(protocol: Protocol, usage: string | typeof OMIT) {
  const fake = probeContext(inOrder(reply(protocol, { usage })), { protocol })
  const signals = await usageArithmetic.run(fake.context)
  expect(signals).toHaveLength(1)
  const [found] = signals
  expect(found?.family).toBe('accounting')
  expect(found?.llr.identity).toBeUndefined()
  expect(found?.llr.platform).toBeUndefined()
  return found
}

describe('accounting/usage-arithmetic', () => {
  it.each([
    ['anthropic-messages', '{"input_tokens":312,"output_tokens":1}', 'documented'],
    [
      'anthropic-messages',
      '{"input_tokens":4,"cache_read_input_tokens":300,"output_tokens":9,"output_tokens_details":{"thinking_tokens":8}}',
      'documented',
    ],
    [
      'openai-chat',
      '{"prompt_tokens":300,"completion_tokens":9,"total_tokens":309,"prompt_tokens_details":{"cached_tokens":256},"completion_tokens_details":{"reasoning_tokens":8}}',
      'documented',
    ],
    ['openai-responses', '{"input_tokens":300,"output_tokens":16,"total_tokens":316}', 'heuristic'],
    [
      'openai-responses',
      '{"input_tokens":300,"input_tokens_details":{"cached_tokens":0},"output_tokens":16,"output_tokens_details":{"reasoning_tokens":16},"total_tokens":316}',
      'documented',
    ],
  ] as const)('finds %s counts that add up: %s', async (protocol, usage, calibration) => {
    const found = await runWith(protocol, usage)

    expect(found).toMatchObject({ signalId: 'consistent', calibration, llr: {} })
    expect(found?.observed).toContain('consistent')
  })

  it('cites what it checked when Anthropic counts add up', async () => {
    const found = await runWith('anthropic-messages', '{"input_tokens":312,"output_tokens":1}')

    expect(found?.citations).toEqual([ANTHROPIC_USAGE_TOTAL_INPUT, ANTHROPIC_OUTPUT_NON_ZERO])
  })

  it.each([
    [
      'a zero output_tokens',
      'anthropic-messages',
      '{"input_tokens":312,"output_tokens":0}',
      'documented',
      0.4,
    ],
    [
      'thinking beyond the output',
      'anthropic-messages',
      '{"input_tokens":312,"output_tokens":1,"output_tokens_details":{"thinking_tokens":5}}',
      'documented',
      0.4,
    ],
    ['no input_tokens', 'anthropic-messages', '{"output_tokens":1}', 'documented', 0.3],
    [
      'a total that is not the sum',
      'openai-chat',
      '{"prompt_tokens":300,"completion_tokens":1,"total_tokens":290}',
      'documented',
      0.5,
    ],
    [
      'more cached tokens than prompt tokens',
      'openai-chat',
      '{"prompt_tokens":300,"completion_tokens":1,"total_tokens":301,"prompt_tokens_details":{"cached_tokens":400}}',
      'documented',
      0.4,
    ],
    [
      'more reasoning tokens than completion tokens',
      'openai-chat',
      '{"prompt_tokens":300,"completion_tokens":1,"total_tokens":301,"completion_tokens_details":{"reasoning_tokens":2}}',
      'documented',
      0.4,
    ],
    [
      'no total_tokens',
      'openai-chat',
      '{"prompt_tokens":300,"completion_tokens":1}',
      'heuristic',
      0.3,
    ],
    [
      'a Responses total that is not the sum',
      'openai-responses',
      '{"input_tokens":300,"output_tokens":16,"total_tokens":300}',
      'heuristic',
      0.3,
    ],
    [
      'more cached tokens than input tokens',
      'openai-responses',
      '{"input_tokens":300,"input_tokens_details":{"cached_tokens":512},"output_tokens":16,"total_tokens":316}',
      'documented',
      0.4,
    ],
    [
      'more reasoning tokens than output tokens',
      'openai-responses',
      '{"input_tokens":300,"output_tokens":16,"output_tokens_details":{"reasoning_tokens":20},"total_tokens":316}',
      'documented',
      0.4,
    ],
    [
      'no output_tokens on Responses',
      'openai-responses',
      '{"input_tokens":300,"total_tokens":300}',
      'heuristic',
      0.3,
    ],
  ] as const)(
    'moves only translation on %s',
    async (_label, protocol, usage, calibration, ratio) => {
      const found = await runWith(protocol, usage)

      expect(found).toMatchObject({
        signalId: 'inconsistent',
        calibration,
        llr: { translation: { translated: ratio } },
      })
      expect(found?.observed).toContain('do not add up')
    },
  )

  it('takes the heaviest broken rule, and cites only the rules that broke', async () => {
    const chat = await runWith(
      'openai-chat',
      '{"prompt_tokens":300,"completion_tokens":1,"total_tokens":290,"prompt_tokens_details":{"cached_tokens":400}}',
    )
    const responses = await runWith(
      'openai-responses',
      '{"input_tokens":300,"output_tokens":16,"output_tokens_details":{"reasoning_tokens":20},"total_tokens":316}',
    )

    expect(chat?.llr.translation).toEqual({ translated: 0.5 })
    expect(chat?.citations).toContain(OPENAI_CHAT_CACHED_TOKENS)
    expect(chat?.citations).toContain(OPENAI_CHAT_TOTAL_TOKENS)
    expect(responses?.citations).toEqual([OPENAI_RESPONSES_OUTPUT_BREAKDOWN])
  })

  it.each([
    ['anthropic-messages', 'documented', 0.4, ANTHROPIC_USAGE_BILLING],
    ['openai-chat', 'heuristic', 0.3, OPENAI_CHAT_USAGE],
    ['openai-responses', 'heuristic', 0.3, OPENAI_RESPONSES_TOTAL_TOKENS],
  ] as const)('reads a %s response without usage', async (protocol, calibration, ratio, source) => {
    const found = await runWith(protocol, OMIT)

    expect(found).toMatchObject({
      signalId: 'no-usage',
      calibration,
      llr: { translation: { translated: ratio } },
      citations: [source],
    })
  })

  it('is lost when the baseline is not answered', async () => {
    const fake = probeContext(inOrder(exchange(502)))

    await expect(usageArithmetic.run(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })
})
