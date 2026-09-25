import { describe, expect, it } from 'vitest'
import { anthropicDifferential } from '../../../src/probes/tokenizer/anthropic-differential.js'
import { BATTERY, BATTERY_COST } from '../../../src/probes/tokenizer/shared.js'
import { ANTHROPIC_NEW_TOKENIZER } from '../../../src/sources/anthropic.js'
import {
  MEASURED_DIFFERENTIAL_COUNT,
  MEASURED_RECOUNTED_USAGE,
} from '../../../src/sources/measured-accounting.js'
import { loadTokenizer } from '../../../src/tokenizer/local.js'
import type { Protocol } from '../../../src/types/target.js'
import { probeContext } from '../../fakes/context.js'
import { countingEndpoint } from '../accounting/replies.js'

const [o200k, cl100k] = await Promise.all([
  loadTokenizer('o200k_base'),
  loadTokenizer('cl100k_base'),
])

const SOURCES = [MEASURED_DIFFERENTIAL_COUNT, MEASURED_RECOUNTED_USAGE, ANTHROPIC_NEW_TOKENIZER]

type Count = (prompt: string) => number | undefined

async function runWith(count: Count, protocol: Protocol = 'anthropic-messages') {
  const fake = probeContext(countingEndpoint(protocol, count), {
    protocol,
    vendor: 'anthropic',
    model: 'claude-opus-5-5',
  })
  const signals = await anthropicDifferential.run(fake.context)
  expect(signals).toHaveLength(1)
  expect(fake.requests).toHaveLength(BATTERY.length + 1)
  const [found] = signals
  expect(found).toMatchObject({ family: 'tokenizer', calibration: 'derived' })
  return found
}

describe('tokenizer/anthropic-differential', () => {
  it('runs for a Claude claim over every protocol', () => {
    expect(anthropicDifferential).toMatchObject({
      group: 'C',
      protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
      vendors: ['anthropic'],
      needsKey: true,
      cost: BATTERY_COST,
    })
    expect(Object.isFrozen(anthropicDifferential)).toBe(true)
  })

  it("says nothing about counts that match neither of OpenAI's encodings", async () => {
    const found = await runWith((prompt) => Math.round(o200k.count(prompt) * 1.25))

    expect(found).toMatchObject({ signalId: 'not-openai-encoding', llr: {}, citations: SOURCES })
    expect(found?.expected).toContain('o200k_base gives chinese')
    expect(found?.expected).toContain('cl100k_base gives chinese')
  })

  it('reads counts of the current OpenAI encoding on Anthropic Messages', async () => {
    const found = await runWith((prompt) => o200k.count(prompt) + 9)

    expect(found).toMatchObject({
      signalId: 'openai-encoding',
      llr: {
        identity: { 'different-vendor': 0.4, 'matches-claim': -0.4, 'same-vendor-cheaper': -0.4 },
        translation: { translated: 0.4 },
      },
      citations: SOURCES,
    })
    expect(found?.observed).toContain('mean deviation 0.0 from o200k_base')
    expect(found?.plainLanguage).toContain('match o200k_base')
  })

  it('reads counts of the older OpenAI encoding on Anthropic Messages', async () => {
    const found = await runWith((prompt) => cl100k.count(prompt) + 9)

    expect(found).toMatchObject({
      signalId: 'openai-encoding',
      llr: { identity: { 'different-vendor': 0.3 }, translation: { translated: 0.5 } },
    })
    expect(found?.plainLanguage).toContain('match cl100k_base')
  })

  it.each(['openai-chat', 'openai-responses'] as const)(
    'weighs a public encoding towards a layer over %s',
    async (protocol) => {
      const found = await runWith((prompt) => o200k.count(prompt), protocol)

      expect(found).toMatchObject({
        signalId: 'openai-encoding',
        llr: { identity: { 'different-vendor': 0.2 }, translation: { translated: 0.5 } },
      })
    },
  )

  it('says nothing when a prompt is answered without a count', async () => {
    const found = await runWith((prompt) => (prompt.includes('Pasang') ? undefined : 5))

    expect(found).toMatchObject({ signalId: 'no-counts', llr: {}, citations: SOURCES })
  })

  it('reads the same count for every prompt as written by a layer', async () => {
    const found = await runWith(() => 312)

    expect(found).toMatchObject({
      signalId: 'constant-counts',
      llr: { identity: { 'not-a-live-model': 0.2 }, translation: { translated: 0.5 } },
    })
  })
})
