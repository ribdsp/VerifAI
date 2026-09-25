import { openaiFingerprintExpectation } from '@verifai/fingerprints'
import { describe, expect, it } from 'vitest'
import { systemFingerprint } from '../../../src/probes/accounting/system-fingerprint.js'
import { ProbeNotApplicable } from '../../../src/runner/errors.js'
import { ANTHROPIC_COMPAT_FINGERPRINT_EMPTY } from '../../../src/sources/anthropic-conformance-common.js'
import { inOrder, probeContext, probeTarget } from '../../fakes/context.js'
import { OMIT, reply } from './replies.js'

async function runWith(fingerprint: string | null | typeof OMIT, model = 'gpt-5') {
  const fake = probeContext(inOrder(reply('openai-chat', { fingerprint })), {
    protocol: 'openai-chat',
    model,
  })
  const signals = await systemFingerprint.run(fake.context)
  expect(signals).toHaveLength(1)
  const [found] = signals
  expect(found?.calibration).toBe('heuristic')
  return found
}

describe('accounting/system-fingerprint', () => {
  it('applies to the chat models OpenAI lists, and to nothing else', () => {
    const applies = (model: string) =>
      systemFingerprint.applies?.(probeTarget({ protocol: 'openai-chat', model }))

    expect(applies('gpt-5')).toBe(true)
    expect(applies('gpt-4o-2024-08-06')).toBe(true)
    expect(applies('gpt-oss-120b')).toBe(false)
    expect(applies('house-model-7')).toBe(false)
  })

  it('refuses to run for a model OpenAI documents no fingerprint for', async () => {
    const fake = probeContext(inOrder(reply('openai-chat')), {
      protocol: 'openai-chat',
      model: 'house-model-7',
    })

    await expect(systemFingerprint.run(fake.context)).rejects.toBeInstanceOf(ProbeNotApplicable)
    expect(fake.requests).toHaveLength(0)
  })

  it.each([
    ['fp_50cad350e4', '"fp_50cad350e4"'],
    [null, 'null'],
  ] as const)('accepts %s as OpenAI-shaped', async (fingerprint, shown) => {
    const found = await runWith(fingerprint)

    expect(found).toMatchObject({ signalId: 'openai-shaped', llr: {} })
    expect(found?.observed).toBe(`The response's system_fingerprint was ${shown}.`)
    expect(found?.citations).toEqual(openaiFingerprintExpectation('gpt-5')?.sources)
  })

  it('reads an empty fingerprint as a layer other than OpenAI, not as a Claude model', async () => {
    const found = await runWith('')

    expect(found).toMatchObject({
      signalId: 'empty',
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
    })
    // Platforms serving the genuine GPT model send it empty too, so it names no model.
    expect(found?.llr).not.toHaveProperty('identity')
    expect(found?.citations).toContain(ANTHROPIC_COMPAT_FINGERPRINT_EMPTY)
    expect(found?.plainLanguage).toMatch(/does not say which model/)
  })

  it.each(['fp_XYZ', 'fp_50cad350e4a1', 'abc123'])('reads %s as a foreign shape', async (value) => {
    const found = await runWith(value)

    expect(found).toMatchObject({
      signalId: 'foreign-shape',
      llr: { identity: { 'different-vendor': 0.2 }, translation: { translated: 0.2 } },
    })
  })

  it('reads a response without the field as rebuilt', async () => {
    const found = await runWith(OMIT)

    expect(found).toMatchObject({ signalId: 'absent', llr: { translation: { translated: 0.2 } } })
    expect(found?.observed).toBe('The response had no system_fingerprint.')
  })
})
