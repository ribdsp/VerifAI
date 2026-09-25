import { describe, expect, it } from 'vitest'
import { hiddenInput } from '../../../src/probes/accounting/hidden-input.js'
import { BASELINE_COST } from '../../../src/probes/accounting/shared.js'
import { ANTHROPIC_USAGE_TOTAL_INPUT } from '../../../src/sources/anthropic.js'
import { MEASURED_ADDED_INPUT } from '../../../src/sources/measured-accounting.js'
import { OPENAI_CHAT_PROMPT_TOKENS } from '../../../src/sources/openai.js'
import { OPENAI_RESPONSES_INPUT_TOKENS } from '../../../src/sources/openai-accounting.js'
import { loadTokenizer } from '../../../src/tokenizer/local.js'
import type { Protocol } from '../../../src/types/target.js'
import { inOrder, type ProbeAnswer, probeContext } from '../../fakes/context.js'
import { countingEndpoint, OMIT, promptOf, type ReplyFields, reply } from './replies.js'

const o200k = await loadTokenizer('o200k_base')

/** The most input the probe lets through for `prompt`, per MEASURED_ADDED_INPUT. */
const boundFor = (prompt: string) => 3 * o200k.count(prompt) + 64

async function runWith(protocol: Protocol, answer: ProbeAnswer) {
  const fake = probeContext(answer, { protocol })
  const signals = await hiddenInput.run(fake.context)
  return { signals, found: signals[0], requests: fake.requests }
}

const replying = (protocol: Protocol, fields: ReplyFields = {}) =>
  runWith(protocol, inOrder(reply(protocol, fields)))

describe('accounting/hidden-input', () => {
  it.each([
    [
      'anthropic-messages',
      '312 input tokens (input_tokens plus cache reads and writes)',
      ANTHROPIC_USAGE_TOTAL_INPUT,
    ],
    ['openai-chat', '300 input tokens (prompt_tokens)', OPENAI_CHAT_PROMPT_TOKENS],
    ['openai-responses', '300 input tokens (input_tokens)', OPENAI_RESPONSES_INPUT_TOKENS],
  ] as const)('finds a %s input count that fits the prompt', async (protocol, count, field) => {
    const { found, requests } = await replying(protocol)

    expect(requests).toHaveLength(1)
    expect(found).toMatchObject({
      signalId: 'no-added-input',
      family: 'accounting',
      calibration: 'heuristic',
      llr: {},
      citations: [MEASURED_ADDED_INPUT, field],
    })
    expect(found?.observed).toContain(count)
  })

  it('reads an input count many times the prompt as input a layer added', async () => {
    const { found } = await replying('openai-chat', {
      usage: '{"prompt_tokens":4752,"completion_tokens":1,"total_tokens":4753}',
    })

    expect(found).toMatchObject({
      signalId: 'added-input',
      calibration: 'heuristic',
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.3 } },
      citations: [MEASURED_ADDED_INPUT, OPENAI_CHAT_PROMPT_TOKENS],
    })
    expect(found?.observed).toContain('4752 input tokens (prompt_tokens)')
    expect(found?.plainLanguage).toContain('4752 input tokens')
    expect(found?.plainLanguage).toMatch(/billed/)
  })

  it('never moves identity: a layer adds the same input in front of the genuine model', async () => {
    const { found } = await replying('anthropic-messages', {
      usage: '{"input_tokens":5107,"output_tokens":1}',
    })

    expect(found?.signalId).toBe('added-input')
    expect(found?.llr).not.toHaveProperty('identity')
  })

  it("counts Anthropic's cache reads and writes as input", async () => {
    const { found } = await replying('anthropic-messages', {
      usage:
        '{"input_tokens":40,"cache_read_input_tokens":3000,"cache_creation_input_tokens":1000,"output_tokens":1}',
    })

    expect(found?.signalId).toBe('added-input')
    expect(found?.observed).toContain(
      '4040 input tokens (input_tokens plus cache reads and writes)',
    )
  })

  it.each(['anthropic-messages', 'openai-chat', 'openai-responses'] as const)(
    'lets %s through at the bound and flags one token past it',
    async (protocol) => {
      const at = await runWith(protocol, countingEndpoint(protocol, boundFor))
      const past = await runWith(
        protocol,
        countingEndpoint(protocol, (prompt) => boundFor(prompt) + 1),
      )

      expect(at.found?.signalId).toBe('no-added-input')
      expect(past.found?.signalId).toBe('added-input')
    },
  )

  it('says what it measured against in the expectation', async () => {
    const { found, requests } = await runWith(
      'openai-chat',
      countingEndpoint('openai-chat', () => 300),
    )
    const [sent] = requests
    if (sent === undefined) {
      throw new TypeError('The probe sent no baseline')
    }
    const prompt = promptOf(sent)

    expect(found?.expected).toContain(`At most ${boundFor(prompt)} input tokens`)
    expect(found?.observed).toContain(`${o200k.count(prompt)} tokens under o200k_base`)
  })

  it('leaves an answer with no usage to accounting/usage-arithmetic', async () => {
    const { signals } = await replying('openai-chat', { usage: OMIT })

    expect(signals).toEqual([])
  })

  it('declares the shared baseline as its only cost', () => {
    expect(hiddenInput).toMatchObject({
      id: 'accounting/hidden-input',
      group: 'B',
      needsKey: true,
      protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
      vendors: ['anthropic', 'openai'],
      cost: BASELINE_COST,
    })
    expect(hiddenInput.citations).toEqual([
      MEASURED_ADDED_INPUT,
      ANTHROPIC_USAGE_TOTAL_INPUT,
      OPENAI_CHAT_PROMPT_TOKENS,
      OPENAI_RESPONSES_INPUT_TOKENS,
    ])
  })
})
