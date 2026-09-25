import { openaiEncodingFor } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { openaiLocalCount } from '../../../src/probes/tokenizer/openai-local-count.js'
import { BATTERY, BATTERY_COST } from '../../../src/probes/tokenizer/shared.js'
import { ProbeNotApplicable } from '../../../src/runner/errors.js'
import {
  MEASURED_DIFFERENTIAL_COUNT,
  MEASURED_ESTIMATED_USAGE,
  MEASURED_RECOUNTED_USAGE,
} from '../../../src/sources/measured-accounting.js'
import { loadTokenizer } from '../../../src/tokenizer/local.js'
import type { Protocol } from '../../../src/types/target.js'
import { probeContext, probeTarget } from '../../fakes/context.js'
import { countingEndpoint } from '../accounting/replies.js'

const [o200k, cl100k] = await Promise.all([
  loadTokenizer('o200k_base'),
  loadTokenizer('cl100k_base'),
])

type Count = (prompt: string) => number | undefined

async function runWith(count: Count, model = 'gpt-5', protocol: Protocol = 'openai-chat') {
  const fake = probeContext(countingEndpoint(protocol, count), { protocol, model })
  const signals = await openaiLocalCount.run(fake.context)
  expect(signals).toHaveLength(1)
  expect(fake.requests).toHaveLength(BATTERY.length + 1)
  const [found] = signals
  expect(found).toMatchObject({ family: 'tokenizer', calibration: 'derived' })
  return found
}

describe('tokenizer/openai-local-count', () => {
  it('applies to the OpenAI models whose encoding is public', () => {
    const applies = (model: string) =>
      openaiLocalCount.applies?.(probeTarget({ protocol: 'openai-chat', model }))

    expect(applies('gpt-5')).toBe(true)
    expect(applies('gpt-4')).toBe(true)
    expect(applies('gpt-6-astra')).toBe(false)
    expect(applies('gpt-oss-120b')).toBe(false)
    expect(openaiLocalCount).toMatchObject({ group: 'C', needsKey: true, cost: BATTERY_COST })
    expect(Object.isFrozen(openaiLocalCount)).toBe(true)
  })

  it.each(['gpt-6-astra', 'gpt-oss-120b'])('refuses to run for %s', async (model) => {
    const fake = probeContext(
      countingEndpoint('openai-chat', () => 5),
      {
        protocol: 'openai-chat',
        model,
      },
    )

    await expect(openaiLocalCount.run(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
    expect(fake.requests).toHaveLength(0)
  })

  it.each(['openai-chat', 'openai-responses'] as const)(
    'accepts counts of the claimed encoding over %s, whatever the template adds',
    async (protocol) => {
      const found = await runWith((prompt) => o200k.count(prompt) + 7, 'gpt-5', protocol)

      expect(found).toMatchObject({
        signalId: 'claimed-encoding',
        llr: { identity: { 'matches-claim': 0.2, 'different-vendor': -0.4 } },
      })
      expect(found?.citations).toEqual([
        ...(openaiEncodingFor('gpt-5')?.sources ?? []),
        MEASURED_DIFFERENTIAL_COUNT,
        MEASURED_RECOUNTED_USAGE,
      ])
      expect(found?.observed).toContain('mean deviation 0.0 from o200k_base')
      expect(found?.plainLanguage).toContain('o200k_base')
    },
  )

  it('reads counts of the older encoding for a newer model', async () => {
    const found = await runWith((prompt) => cl100k.count(prompt) + 3)

    expect(found).toMatchObject({
      signalId: 'older-encoding',
      llr: {
        identity: { 'same-vendor-cheaper': 0.2, 'matches-claim': -0.4 },
        translation: { translated: 0.5 },
      },
    })
    expect(found?.plainLanguage).toContain('cl100k_base, the encoding of older OpenAI models')
  })

  it('reads counts of the newer encoding for an older model', async () => {
    const found = await runWith((prompt) => o200k.count(prompt) + 3, 'gpt-4')

    expect(found).toMatchObject({
      signalId: 'newer-encoding',
      llr: {
        identity: { 'same-vendor-cheaper': 0.5, 'matches-claim': -0.6 },
        translation: { translated: 0.3 },
      },
    })
    expect(found?.expected).toContain('The deltas cl100k_base gives')
  })

  it('reads counts far from both encodings as another tokenizer', async () => {
    const found = await runWith((prompt) => o200k.count(prompt) * 2)

    expect(found).toMatchObject({
      signalId: 'foreign-tokenizer',
      llr: {
        identity: { 'different-vendor': 0.4, 'matches-claim': -0.4, 'same-vendor-cheaper': -0.4 },
        translation: { translated: 0.3 },
      },
    })
  })

  it('does not read a count one token off as another tokenizer', async () => {
    const found = await runWith(
      (prompt) => o200k.count(prompt) + (prompt.includes('Pasang') ? 1 : 0),
    )

    expect(found).toMatchObject({ signalId: 'near-encoding', llr: {} })
    expect(found?.plainLanguage).toContain('missing by 0.1 tokens')
  })

  it('says nothing when a prompt is answered without a count', async () => {
    const found = await runWith((prompt) => (prompt.includes('Pasang') ? undefined : 5))

    expect(found).toMatchObject({ signalId: 'no-counts', llr: {} })
    expect(found?.citations).toContain(MEASURED_RECOUNTED_USAGE)
  })

  it.each([
    ['the same count for every prompt', () => 40, 'constant-counts'],
    [
      'a count of characters / 4',
      (prompt: string) => Math.round(prompt.length / 4),
      'estimated-counts',
    ],
  ])('reads %s as written by a layer', async (_label, count, signalId) => {
    const found = await runWith(count)

    expect(found?.signalId).toBe(signalId)
    expect(found?.llr.translation).toEqual({ translated: 0.5 })
    expect(found?.citations).toEqual([MEASURED_ESTIMATED_USAGE, MEASURED_DIFFERENTIAL_COUNT])
  })
})
