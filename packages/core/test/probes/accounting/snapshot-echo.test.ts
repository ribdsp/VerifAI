import { anthropicModel, openaiSnapshotFor } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { normalizeModelName, snapshotEcho } from '../../../src/probes/accounting/snapshot-echo.js'
import {
  ANTHROPIC_BEDROCK_V1_SUFFIX,
  ANTHROPIC_RESPONSE_MODEL,
} from '../../../src/sources/anthropic-accounting.js'
import {
  MEASURED_MODEL_SPELLINGS,
  MEASURED_OTHER_FAMILIES,
} from '../../../src/sources/measured-accounting.js'
import {
  OPENAI_CHAT_RESPONSE_MODEL,
  OPENAI_RESPONSES_MODEL,
} from '../../../src/sources/openai-accounting.js'
import type { Protocol } from '../../../src/types/target.js'
import { inOrder, probeContext } from '../../fakes/context.js'
import { OMIT, reply } from './replies.js'

interface Claim {
  readonly protocol: Protocol
  readonly model: string
}

const OPUS: Claim = { protocol: 'anthropic-messages', model: 'claude-opus-5-5' }
const OPUS_OVER_CHAT: Claim = { protocol: 'openai-chat', model: 'claude-opus-5-5' }
const GPT: Claim = { protocol: 'openai-chat', model: 'gpt-5' }

function vendorOf(model: string) {
  return model.startsWith('claude-') ? 'anthropic' : 'openai'
}

async function echoed(claim: Claim, echo: string | typeof OMIT) {
  const fake = probeContext(inOrder(reply(claim.protocol, { model: echo })), {
    protocol: claim.protocol,
    vendor: vendorOf(claim.model),
    model: claim.model,
  })
  const signals = await snapshotEcho.run(fake.context)
  expect(signals).toHaveLength(1)
  const [found] = signals
  expect(found?.family).toBe('accounting')
  return found
}

function sourcesOf(model: string) {
  const found = anthropicModel(model)
  if (found === undefined) {
    throw new TypeError(`${model} is not listed`)
  }
  return found
}

describe('accounting/snapshot-echo under a gateway name', () => {
  it("accepts the gateway's own name as the one the request carried", async () => {
    const fake = probeContext(
      inOrder(reply('anthropic-messages', { model: 'reseller/claude-opus-4.6' })),
      { model: 'claude-opus-4-6', requestedModel: 'reseller/claude-opus-4.6' },
    )
    const [found] = await snapshotEcho.run(fake.context)

    expect(found).toMatchObject({
      signalId: 'matches',
      llr: {},
      observed: `The response's model was "reseller/claude-opus-4.6"; the request named "reseller/claude-opus-4.6".`,
    })
    expect(fake.requests[0]?.body).toMatchObject({ json: { model: 'reseller/claude-opus-4.6' } })
  })

  it("accepts the vendor's name for the model the gateway renamed", async () => {
    const fake = probeContext(inOrder(reply('anthropic-messages', { model: 'claude-opus-4-6' })), {
      model: 'claude-opus-4-6',
      requestedModel: 'reseller/claude-opus-4.6',
    })
    const [found] = await snapshotEcho.run(fake.context)

    expect(found?.signalId).toBe('matches')
  })

  it('still reads a cheaper model behind a gateway name', async () => {
    const fake = probeContext(
      inOrder(reply('anthropic-messages', { model: 'claude-haiku-4-5-20251001' })),
      { model: 'claude-opus-4-6', requestedModel: 'reseller/claude-opus-4.6' },
    )
    const [found] = await snapshotEcho.run(fake.context)

    expect(found?.signalId).toBe('cheaper-model')
  })
})

describe('normalizeModelName', () => {
  it.each([
    [' US.Anthropic.Claude-Sonnet-4-5-20250929-V1:0 ', 'claude-sonnet-4-5-20250929'],
    ['eu.anthropic.claude-opus-4-5-20251101-v1', 'claude-opus-4-5-20251101'],
    ['claude-sonnet-4-5@20250929', 'claude-sonnet-4-5-20250929'],
    ['anthropic/claude-sonnet-4.5', 'claude-sonnet-4-5'],
    ['Claude-Opus-5.5', 'claude-opus-5-5'],
    ['openai/gpt-4.1', 'gpt-4.1'],
    ['gpt-5-2025-08-07', 'gpt-5-2025-08-07'],
  ])('reads %s as %s', (name, expected) => {
    expect(normalizeModelName(name)).toBe(expected)
  })
})

describe('accounting/snapshot-echo, for a Claude claim', () => {
  it('accepts the claimed model, citing where Anthropic lists it', async () => {
    const found = await echoed(OPUS, 'claude-opus-5-5')

    expect(found).toMatchObject({ signalId: 'matches', calibration: 'documented', llr: {} })
    expect(found?.citations).toEqual([
      ANTHROPIC_RESPONSE_MODEL,
      sourcesOf('claude-opus-5-5').idSource,
    ])
    expect(found?.observed).toBe(
      `The response's model was "claude-opus-5-5"; the request named "claude-opus-5-5".`,
    )
  })

  it('accepts the dated snapshot of an alias', async () => {
    const found = await echoed(
      { protocol: 'anthropic-messages', model: 'claude-sonnet-4-5' },
      'claude-sonnet-4-5-20250929',
    )

    expect(found?.signalId).toBe('matches')
    expect(found?.expected).toBe('A model of "claude-sonnet-4-5", "claude-sonnet-4-5-20250929".')
  })

  it('says nothing when the response names no model', async () => {
    const found = await echoed(OPUS, OMIT)

    expect(found).toMatchObject({
      signalId: 'missing',
      llr: {},
      citations: [ANTHROPIC_RESPONSE_MODEL],
    })
    expect(found?.observed).toContain('The response had no model')
  })

  it.each([
    [OPUS, ''],
    [GPT, ''],
    [GPT, '  '],
  ])(
    'reads an empty model as a rebuilt response, not as another model: %j %j',
    async (claim, echo) => {
      const found = await echoed(claim, echo)

      expect(found).toMatchObject({
        signalId: 'empty',
        calibration: 'heuristic',
        llr: { platform: { 'first-party': -0.2 }, translation: { translated: 0.2 } },
      })
      expect(found?.llr).not.toHaveProperty('identity')
      expect(found?.plainLanguage).toMatch(/empty/)
    },
  )

  it.each([
    ['anthropic.claude-sonnet-4-5-20250929-v1:0'],
    ['us.anthropic.claude-sonnet-4-5-20250929-v1:0'],
    ['claude-sonnet-4-5@20250929'],
  ])('reads %s as the claimed model spelled by a cloud platform', async (echo) => {
    const found = await echoed({ protocol: 'anthropic-messages', model: 'claude-sonnet-4-5' }, echo)

    expect(found).toMatchObject({
      signalId: 'renamed',
      calibration: 'heuristic',
      llr: { platform: { 'partner-cloud': 0.2 }, translation: { translated: 0.1 } },
    })
    expect(found?.citations).toContain(ANTHROPIC_BEDROCK_V1_SUFFIX)
    expect(found?.citations).toContain(MEASURED_MODEL_SPELLINGS)
  })

  it('reads another spelling of the claimed model as a rename by a router', async () => {
    const found = await echoed(OPUS, 'anthropic/claude-opus-5.5')

    expect(found).toMatchObject({
      signalId: 'renamed',
      llr: { translation: { translated: 0.2 } },
      citations: [ANTHROPIC_RESPONSE_MODEL, MEASURED_MODEL_SPELLINGS],
    })
  })

  it('reads a cheaper Claude model as the documented substitution', async () => {
    const found = await echoed(OPUS, 'claude-sonnet-5')
    const sonnet = sourcesOf('claude-sonnet-5')

    expect(found).toMatchObject({
      signalId: 'cheaper-model',
      calibration: 'documented',
      llr: { identity: { 'same-vendor-cheaper': 0.8, 'matches-claim': -0.8 } },
    })
    expect(found?.citations).toContain(sonnet.idSource)
    expect(found?.citations).toEqual(expect.arrayContaining([...(sonnet.pricing?.sources ?? [])]))
    expect(found?.plainLanguage).toContain('Claude Sonnet 5')
  })

  it('finds a cheaper model by its alias', async () => {
    const found = await echoed(OPUS, 'claude-haiku-4-5')

    expect(found?.signalId).toBe('cheaper-model')
  })

  it('reads a Claude model that costs more as another Claude model', async () => {
    const found = await echoed(OPUS, 'claude-fable-5-1')

    expect(found).toMatchObject({
      signalId: 'other-claude',
      calibration: 'documented',
      llr: { identity: { 'matches-claim': -0.6 } },
      citations: [ANTHROPIC_RESPONSE_MODEL, sourcesOf('claude-fable-5-1').idSource],
    })
  })

  it('weighs Claude substitutions less over a protocol Anthropic does not own', async () => {
    const cheaper = await echoed(OPUS_OVER_CHAT, 'claude-sonnet-5')
    const other = await echoed(OPUS_OVER_CHAT, 'claude-fable-5-1')

    expect(cheaper).toMatchObject({
      signalId: 'cheaper-model',
      calibration: 'heuristic',
      llr: { identity: { 'same-vendor-cheaper': 0.3, 'matches-claim': -0.3 } },
    })
    expect(cheaper?.citations[0]).toBe(OPENAI_CHAT_RESPONSE_MODEL)
    expect(other).toMatchObject({
      signalId: 'other-claude',
      calibration: 'heuristic',
      llr: { identity: { 'matches-claim': -0.3 } },
    })
  })

  it('reads a Claude name Anthropic does not list', async () => {
    const found = await echoed(OPUS, 'claude-3-haiku-lite')

    expect(found).toMatchObject({
      signalId: 'unlisted-claude',
      calibration: 'heuristic',
      llr: { identity: { 'same-vendor-cheaper': 0.2, 'matches-claim': -0.3 } },
      citations: [ANTHROPIC_RESPONSE_MODEL],
    })
  })

  it('reads a listed OpenAI model as another vendor, citing its listing', async () => {
    const found = await echoed(OPUS, 'gpt-5-2025-08-07')

    expect(found).toMatchObject({
      signalId: 'other-vendor',
      calibration: 'documented',
      llr: { identity: { 'different-vendor': 0.8, 'matches-claim': -0.6 } },
    })
    expect(found?.citations).toEqual(
      expect.arrayContaining([...(openaiSnapshotFor('gpt-5-2025-08-07')?.sources ?? [])]),
    )
    expect(found?.plainLanguage).toBe(
      'The response says it was produced by "gpt-5-2025-08-07", an OpenAI model, while you asked for "claude-opus-5-5", an Anthropic model.',
    )
  })

  it.each([
    [OPUS, 'gpt-6-astra'],
    [OPUS_OVER_CHAT, 'gpt-5-2025-08-07'],
  ])('derives another vendor from an OpenAI name no listing backs: %j, %s', async (claim, echo) => {
    const found = await echoed(claim, echo)

    expect(found).toMatchObject({
      signalId: 'other-vendor',
      calibration: 'derived',
      llr: { identity: { 'different-vendor': 0.6, 'matches-claim': -0.5 } },
    })
  })

  it.each(['deepseek-chat', 'openrouter/qwen/qwen3-coder', 'meta-llama/Llama-3.3-70B-Instruct'])(
    "reads %s as another developer's model",
    async (echo) => {
      const found = await echoed(OPUS, echo)

      expect(found).toMatchObject({
        signalId: 'other-family',
        calibration: 'derived',
        llr: { identity: { 'different-vendor': 0.6, 'matches-claim': -0.6 } },
        citations: [ANTHROPIC_RESPONSE_MODEL, MEASURED_OTHER_FAMILIES],
      })
    },
  )

  it('reads a name nobody lists as unrecognised', async () => {
    const found = await echoed(OPUS, 'house-model-7')

    expect(found).toMatchObject({
      signalId: 'unrecognised',
      calibration: 'heuristic',
      llr: { identity: { 'different-vendor': 0.2 }, translation: { translated: 0.2 } },
      citations: [ANTHROPIC_RESPONSE_MODEL],
    })
  })

  it('accepts the exact name of a claim Anthropic does not list', async () => {
    const found = await echoed(
      { protocol: 'anthropic-messages', model: 'claude-house-1' },
      'claude-house-1',
    )

    expect(found).toMatchObject({ signalId: 'matches', citations: [ANTHROPIC_RESPONSE_MODEL] })
  })
})

describe('accounting/snapshot-echo, for an OpenAI claim', () => {
  it.each(['gpt-5', 'gpt-5-2025-08-07', 'gpt-5-2026-01-15'])(
    'accepts %s for an undated claim',
    async (echo) => {
      const found = await echoed(GPT, echo)

      expect(found).toMatchObject({ signalId: 'matches', llr: {} })
      expect(found?.expected).toBe(
        'A model of "gpt-5", "gpt-5-2025-08-07", or "gpt-5" with a date.',
      )
      expect(found?.citations).toEqual([
        OPENAI_CHAT_RESPONSE_MODEL,
        ...(openaiSnapshotFor('gpt-5')?.sources ?? []),
      ])
    },
  )

  it('accepts only the pinned snapshot for a dated claim', async () => {
    const claim: Claim = { protocol: 'openai-responses', model: 'gpt-4o-2024-08-06' }
    const pinned = await echoed(claim, 'gpt-4o-2024-08-06')
    const other = await echoed(claim, 'gpt-4o-2024-11-20')

    expect(pinned?.signalId).toBe('matches')
    expect(pinned?.expected).toBe('A model of "gpt-4o-2024-08-06".')
    expect(pinned?.citations[0]).toBe(OPENAI_RESPONSES_MODEL)
    expect(other).toMatchObject({
      signalId: 'other-gpt',
      llr: { identity: { 'matches-claim': -0.3 } },
    })
  })

  it('accepts a dated answer to a claim OpenAI does not list', async () => {
    const found = await echoed(
      { protocol: 'openai-chat', model: 'gpt-6-astra' },
      'gpt-6-astra-2026-05-01',
    )

    expect(found).toMatchObject({ signalId: 'matches', citations: [OPENAI_CHAT_RESPONSE_MODEL] })
  })

  it('reads a router prefix as a rename', async () => {
    const found = await echoed(GPT, 'openai/gpt-5')

    expect(found).toMatchObject({ signalId: 'renamed', llr: { translation: { translated: 0.2 } } })
  })

  it('reads a smaller variant as a cheaper model', async () => {
    const found = await echoed(GPT, 'gpt-5-mini')

    expect(found).toMatchObject({
      signalId: 'smaller-model',
      calibration: 'heuristic',
      llr: { identity: { 'same-vendor-cheaper': 0.3, 'matches-claim': -0.3 } },
    })
    expect(found?.plainLanguage).toContain("OpenAI's smaller models")
  })

  it('reads one small variant for another as another model, not a cheaper one', async () => {
    const found = await echoed({ protocol: 'openai-chat', model: 'gpt-5-mini' }, 'gpt-5-nano')

    expect(found?.signalId).toBe('other-gpt')
    expect(found?.citations).toEqual([
      OPENAI_CHAT_RESPONSE_MODEL,
      ...(openaiSnapshotFor('gpt-5-nano')?.sources ?? []),
    ])
  })

  it('reads a listed Claude model as the documented other vendor', async () => {
    const found = await echoed(GPT, 'claude-sonnet-5')

    expect(found).toMatchObject({
      signalId: 'other-vendor',
      calibration: 'documented',
      llr: { identity: { 'different-vendor': 0.8, 'matches-claim': -0.6 } },
      citations: [OPENAI_CHAT_RESPONSE_MODEL, sourcesOf('claude-sonnet-5').idSource],
    })
    expect(found?.plainLanguage).toContain(
      'an Anthropic model, while you asked for "gpt-5", an OpenAI model',
    )
  })

  it.each([
    [GPT, 'claude-3-haiku-lite'],
    [{ protocol: 'anthropic-messages', model: 'gpt-5' } as const, 'claude-sonnet-5'],
  ])('derives another vendor from a Claude name no listing backs: %j, %s', async (claim, echo) => {
    const found = await echoed(claim, echo)

    expect(found).toMatchObject({ signalId: 'other-vendor', calibration: 'derived' })
  })

  it.each([
    ['mistral-large-latest', 'other-family'],
    ['acme-1', 'unrecognised'],
  ])('reads %s as %s', async (echo, signalId) => {
    const found = await echoed(GPT, echo)

    expect(found?.signalId).toBe(signalId)
  })
})
