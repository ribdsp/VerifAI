import { describe, expect, it } from 'vitest'
import { thinkingDisplay } from '../../../src/probes/causal/thinking-display.js'
import { thinkingSignature } from '../../../src/probes/causal/thinking-signature.js'
import type { Exchange } from '../../../src/probes/types.js'
import { ProbeNotApplicable } from '../../../src/runner/errors.js'
import {
  ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47,
  ANTHROPIC_DISPLAY_OMITTED_OPUS_55,
} from '../../../src/sources/anthropic-causal.js'
import { exchange, inOrder, probeContext, probeTarget } from '../../fakes/context.js'
import { message, withinCost } from './replies.js'

// biome-ignore-start lint/style/useNamingConvention: Anthropic's wire names.
function thinking(text: string, signature = 'EqQBCkgIARABGAIiQL2ubfYx'): Exchange {
  return message({
    content: [
      { type: 'thinking', thinking: text, signature },
      { type: 'text', text: '301' },
    ],
    usage: { input_tokens: 120, output_tokens: 700 },
  })
}
// biome-ignore-end lint/style/useNamingConvention: Anthropic's wire names.

const SUMMARY = 'The number is 1 more than a multiple of 60, and divisible by 7: 301.'

async function runWith(model: string, answer: Exchange) {
  const fake = probeContext(inOrder(answer), { model })
  const signals = await thinkingDisplay.run(fake.context)
  expect(fake.requests).toHaveLength(1)
  expect(withinCost(thinkingDisplay, fake)).toBe(true)
  return signals
}

describe('causal/thinking-display', () => {
  it('finds the documented default when an omitting model returns no text', async () => {
    const signals = await runWith('claude-opus-5-5', thinking(''))

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      probeId: 'causal/thinking-display',
      signalId: 'documented-default',
      calibration: 'documented',
      llr: { identity: { 'matches-claim': 0.1 } },
    })
    expect(signals[0]?.citations).toEqual([
      ANTHROPIC_DISPLAY_OMITTED_OPUS_55,
      ANTHROPIC_DISPLAY_OMITTED_FROM_OPUS_47,
    ])
  })

  it('finds the documented default when a summarizing model returns text', async () => {
    const signals = await runWith('claude-opus-4-6', thinking(SUMMARY))

    expect(signals[0]?.signalId).toBe('documented-default')
  })

  it('names a cheaper model when an omitting model returns text a cheaper one would', async () => {
    const signals = await runWith('claude-opus-5-5', thinking(SUMMARY))

    expect(signals[0]).toMatchObject({
      signalId: 'text-by-default',
      llr: {
        identity: { 'matches-claim': -0.5, 'same-vendor-cheaper': 0.3 },
        translation: { translated: 0.4 },
      },
    })
    expect(signals[0]?.observed).toContain(`${SUMMARY.length} characters of text`)
  })

  it('names no cheaper model when none cheaper summarizes', async () => {
    const signals = await runWith('claude-sonnet-5', thinking(SUMMARY))

    expect(signals[0]?.signalId).toBe('text-by-default')
    expect(signals[0]?.llr.identity).toEqual({ 'matches-claim': -0.5 })
  })

  it('reads a signed empty block from a summarizing model as another default', async () => {
    const signals = await runWith('claude-opus-4-6', thinking(''))

    expect(signals[0]).toMatchObject({
      signalId: 'empty-by-default',
      llr: {
        identity: { 'matches-claim': -0.5, 'same-vendor-cheaper': 0.3 },
        translation: { translated: 0.3 },
      },
    })
  })

  it.each([
    ['an empty unsigned block', 'claude-opus-4-6', thinking('', '')],
    ['a failed request', 'claude-opus-5-5', exchange(500, 'upstream failed')],
    [
      'only redacted thinking',
      'claude-opus-5-5',
      message({ content: [{ type: 'redacted_thinking', data: 'EmwKAhgBEgy3va3pzix' }] }),
    ],
  ])('judges nothing from %s', async (_label, model, answer) => {
    expect(await runWith(model, answer)).toEqual([])
  })

  it('shares the first turn with causal/thinking-signature', async () => {
    const fake = probeContext(inOrder(thinking(''), exchange(500)))

    await thinkingSignature.run(fake.context)
    await thinkingDisplay.run(fake.context)

    expect(fake.requests).toHaveLength(2)
  })

  it.each(['claude-haiku-4-5-20251001', 'claude-unknown-9'])(
    'is not applicable to %s, which has no documented default',
    async (model) => {
      const fake = probeContext(inOrder(thinking('')), { model })

      expect(thinkingDisplay.applies?.(fake.context.target)).toBe(false)
      await expect(thinkingDisplay.run(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
      expect(fake.requests).toHaveLength(0)
    },
  )

  it('applies to catalogued models with a documented default', () => {
    expect(thinkingDisplay.applies?.(probeTarget({ model: 'claude-sonnet-4-6' }))).toBe(true)
    expect(thinkingDisplay.applies?.(probeTarget({ protocol: 'openai-chat' }))).toBe(false)
  })
})
