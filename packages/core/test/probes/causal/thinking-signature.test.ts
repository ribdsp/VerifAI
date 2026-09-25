import { describe, expect, it } from 'vitest'
import { thinkingSignature } from '../../../src/probes/causal/thinking-signature.js'
import type { Exchange } from '../../../src/probes/types.js'
import { ProbeLost, ProbeNotApplicable } from '../../../src/runner/errors.js'
import {
  ANTHROPIC_THINKING_KEPT,
  ANTHROPIC_THINKING_UNREADABLE_DROPPED,
} from '../../../src/sources/anthropic-causal.js'
import { exchange, inOrder, probeContext, probeTarget } from '../../fakes/context.js'
import { anthropicError, bodyOf, message, withinCost } from './replies.js'

const SIGNATURE = 'EqQBCkgIARABGAIiQL2ubfYx4kR7ZpGH9Xy1WtGcTqLsVx8bNo3Jd'

interface SeedFields {
  readonly signature?: string
  readonly output?: number
  readonly thinkingTokens?: number
}

// biome-ignore-start lint/style/useNamingConvention: Anthropic's wire names.
/** A first turn with 120 prompt tokens and, by default, about 697 of thinking. */
function seed(fields: SeedFields = {}): Exchange {
  return message({
    content: [
      { type: 'thinking', thinking: '', signature: fields.signature ?? SIGNATURE },
      { type: 'text', text: '301' },
    ],
    usage: {
      input_tokens: 120,
      output_tokens: fields.output ?? 700,
      ...(fields.thinkingTokens === undefined
        ? {}
        : { output_tokens_details: { thinking_tokens: fields.thinkingTokens } }),
    },
  })
}

/** A replay that reports `input` prompt tokens. */
function replayed(input: number): Exchange {
  return message({ usage: { input_tokens: input, output_tokens: 1 } })
}
// biome-ignore-end lint/style/useNamingConvention: Anthropic's wire names.

/** Well past the first turn's input plus half its thinking. */
const KEPT = replayed(900)
/** No more than the first turn's input plus the replayed text and follow-up. */
const DROPPED = replayed(150)
/** Neither. */
const BETWEEN = replayed(400)

const TAMPER_REFUSED = anthropicError(400, 'Invalid `signature` in `thinking` block')

async function runWith(...answers: readonly (Exchange | Error)[]) {
  const fake = probeContext(inOrder(...answers))
  const signals = await thinkingSignature.run(fake.context)
  expect(withinCost(thinkingSignature, fake)).toBe(true)
  return { fake, signals }
}

function assistantBlocks(body: Record<string, unknown>): Record<string, unknown>[] {
  const messages = body.messages as { role: string; content: unknown }[]
  expect(messages.map((entry) => entry.role)).toEqual(['user', 'assistant', 'user'])
  return messages[1]?.content as Record<string, unknown>[]
}

describe('causal/thinking-signature', () => {
  it('reads a refused altered signature after an accepted replay as the claimed backend', async () => {
    const { fake, signals } = await runWith(seed(), KEPT, TAMPER_REFUSED)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      probeId: 'causal/thinking-signature',
      family: 'causal-capability',
      signalId: 'tamper-rejected',
      calibration: 'documented',
      llr: { identity: { 'different-vendor': -0.5, 'not-a-live-model': -0.5 } },
    })
    expect(fake.requests).toHaveLength(3)
    const [first, control, tampered] = fake.requests
    // biome-ignore lint/style/useNamingConvention: Anthropic's wire name.
    expect(bodyOf(first)).toMatchObject({ thinking: { type: 'adaptive' }, max_tokens: 1280 })
    expect(control?.provokes).toBeUndefined()
    expect(tampered?.provokes).toEqual([400])
    const [kept] = assistantBlocks(bodyOf(control))
    const [altered] = assistantBlocks(bodyOf(tampered))
    expect(kept?.signature).toBe(SIGNATURE)
    const changed = String(altered?.signature)
    expect(changed).toHaveLength(SIGNATURE.length)
    expect([...changed].filter((char, at) => char !== SIGNATURE[at])).toHaveLength(1)
  })

  it('changes an A in the middle of a signature to B', async () => {
    const { fake } = await runWith(seed({ signature: 'xxxxAxxxx' }), KEPT, TAMPER_REFUSED)

    const [altered] = assistantBlocks(bodyOf(fake.requests[2]))
    expect(altered?.signature).toBe('xxxxBxxxx')
  })

  it('vetoes the claim when an altered signature is accepted and its thinking counted', async () => {
    const { signals } = await runWith(seed(), KEPT, KEPT)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'tamper-accepted',
      llr: {
        identity: {
          'matches-claim': -1,
          'same-vendor-cheaper': -0.5,
          'different-vendor': 0.5,
          'not-a-live-model': 0.2,
        },
      },
      vetoes: ['matches-claim', 'same-vendor-cheaper'],
    })
    expect(signals[0]?.citations).toContain(ANTHROPIC_THINKING_KEPT)
  })

  it('says nothing when the altered block is dropped, as Anthropic does with unreadable blocks', async () => {
    const { signals } = await runWith(seed(), KEPT, DROPPED)

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ signalId: 'tamper-dropped', llr: {} })
    expect(signals[0]?.citations).toEqual([ANTHROPIC_THINKING_UNREADABLE_DROPPED])
  })

  it.each([
    ['a count between kept and dropped', BETWEEN],
    ['a server error', exchange(500, 'upstream failed')],
  ])('judges nothing when the altered replay gets %s', async (_label, answer) => {
    const { signals } = await runWith(seed(), KEPT, answer)

    expect(signals).toEqual([])
  })

  it('reads a refused unchanged replay as a layer, not a model', async () => {
    const { fake, signals } = await runWith(
      seed(),
      anthropicError(400, 'messages.1.content.0: thinking blocks cannot be modified'),
    )

    expect(fake.requests).toHaveLength(2)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'replay-rejected',
      llr: { translation: { translated: 0.5 } },
    })
    expect(signals[0]?.llr.identity).toBeUndefined()
  })

  it('reads an unchanged replay whose thinking was not counted as a layer', async () => {
    const { fake, signals } = await runWith(seed(), DROPPED)

    expect(fake.requests).toHaveLength(2)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      signalId: 'thinking-dropped',
      llr: { translation: { translated: 0.5 } },
    })
    expect(signals[0]?.llr.identity).toBeUndefined()
  })

  it.each([
    ['a 400 about something else', anthropicError(400, 'max_tokens: too large')],
    ['a 400 without an error body', exchange(400, 'bad request')],
    ['a count between kept and dropped', BETWEEN],
  ])('stops without a finding when the unchanged replay gets %s', async (_label, answer) => {
    const { fake, signals } = await runWith(seed(), answer)

    expect(fake.requests).toHaveLength(2)
    expect(signals).toEqual([])
  })

  it.each([
    ['failed', exchange(529, 'overloaded')],
    ['has no signed thinking block', seed({ signature: '' })],
    ['thought too little to tell kept from dropped', seed({ output: 200 })],
    ['reports too little thinking', seed({ thinkingTokens: 100 })],
    [
      'carries no input count',
      message({
        content: [{ type: 'thinking', thinking: '', signature: SIGNATURE }],
        // biome-ignore lint/style/useNamingConvention: Anthropic's wire name.
        usage: { output_tokens: 700 },
      }),
    ],
  ])('sends nothing more when the first turn %s', async (_label, first) => {
    const { fake, signals } = await runWith(first)

    expect(fake.requests).toHaveLength(1)
    expect(signals).toEqual([])
  })

  it('measures kept thinking against the reported thinking count', async () => {
    // 120 in, 100 allowed for the text and follow-up, half of 600 thinking: 520.
    const { signals } = await runWith(seed({ thinkingTokens: 600 }), replayed(530), TAMPER_REFUSED)

    expect(signals[0]?.signalId).toBe('tamper-rejected')
  })

  it('asks for manual thinking where adaptive thinking is rejected', async () => {
    const fake = probeContext(inOrder(exchange(500)), { model: 'claude-opus-4-5-20251101' })
    await thinkingSignature.run(fake.context)

    expect(bodyOf(fake.requests[0])).toMatchObject({
      // biome-ignore lint/style/useNamingConvention: Anthropic's wire name.
      thinking: { type: 'enabled', budget_tokens: 1024 },
    })
  })

  it('lets runner errors through', async () => {
    const fake = probeContext(inOrder(seed(), new ProbeLost()))

    await expect(thinkingSignature.run(fake.context)).rejects.toBeInstanceOf(ProbeLost)
  })

  it('is not applicable to a model it knows nothing of', async () => {
    const fake = probeContext(inOrder(seed()), { model: 'claude-unknown-9' })

    await expect(thinkingSignature.run(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
    expect(fake.requests).toHaveLength(0)
  })

  it.each([
    ['claude-opus-5-5', true],
    ['claude-sonnet-4-6', true],
    ['claude-opus-4-5-20251101', true],
    ['claude-sonnet-4-5-20250929', false],
    ['claude-haiku-4-5-20251001', false],
    ['claude-unknown-9', false],
  ])('applies to %s: %s', (model, expected) => {
    expect(thinkingSignature.applies?.(probeTarget({ model }))).toBe(expected)
  })

  it('does not apply to an OpenAI claim', () => {
    expect(thinkingSignature.applies?.(probeTarget({ protocol: 'openai-chat' }))).toBe(false)
  })
})
