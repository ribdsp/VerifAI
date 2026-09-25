import { describe, expect, it } from 'vitest'
import {
  inferVendor,
  MAX_MODEL_ID_LENGTH,
  MODEL_ID_PROBLEMS,
  normaliseModelId,
} from '../src/adapters/model.js'

describe('normaliseModelId', () => {
  it('accepts vendor, platform and gateway id shapes unchanged', () => {
    for (const modelId of [
      'claude-opus-5-5',
      'claude-haiku-4-5-20251001',
      'us.anthropic.claude-sonnet-5-v1:0',
      'claude-sonnet-4-5@20250929',
      'gpt-4o-mini-2024-07-18',
      'ft:gpt-4o-mini:acme::abc123',
      'openrouter/anthropic/claude-opus-5',
      'Claude Opus 5',
    ]) {
      expect(normaliseModelId(modelId)).toEqual({ ok: true, modelId })
    }
  })

  it('trims what a paste carries along', () => {
    expect(normaliseModelId('  gpt-5\n')).toEqual({ ok: true, modelId: 'gpt-5' })
  })

  it('refuses an empty id', () => {
    for (const input of ['', '   ', '\n\t']) {
      expect(normaliseModelId(input)).toEqual({ ok: false, problem: 'empty' })
    }
  })

  it('refuses an id longer than the limit', () => {
    const longest = 'm'.repeat(MAX_MODEL_ID_LENGTH)
    expect(normaliseModelId(longest)).toEqual({ ok: true, modelId: longest })
    expect(normaliseModelId(`${longest}m`)).toEqual({ ok: false, problem: 'too-long' })
  })

  it('refuses characters that make one id render as another', () => {
    for (const input of [
      'gpt-5\u0000',
      'gpt\u00075',
      'gpt-5\u007f',
      'gpt-5\u0085x',
      'claude-\u202eopus', // right-to-left override
      'claude-\u2066opus\u2069', // isolate
      'claude\u200b-opus', // zero-width space
      'claude\u200d-opus', // zero-width joiner
      'claude\u2060-opus', // word joiner
      'claude\ufeff-opus', // BOM inside
      'claude\u00ad-opus', // soft hyphen
      'claude\u061c-opus', // Arabic letter mark
      'claude\u{e0041}-opus', // tag character
      'claude\u2028-opus', // line separator
      'claude\ud800-opus', // lone surrogate
      'gpt\t5',
      'gpt\n5',
    ]) {
      expect(normaliseModelId(input), JSON.stringify(input)).toEqual({
        ok: false,
        problem: 'forbidden-character',
      })
    }
  })

  it('freezes its results and names every problem', () => {
    expect(Object.isFrozen(normaliseModelId('gpt-5'))).toBe(true)
    expect(Object.isFrozen(normaliseModelId(''))).toBe(true)
    expect(MODEL_ID_PROBLEMS.values).toEqual(['empty', 'too-long', 'forbidden-character'])
  })
})

describe('inferVendor', () => {
  it.each([
    'claude-opus-5-5',
    'claude-haiku-4-5-20251001',
    'Claude Opus 5',
    'claude3-opus',
    'anthropic/claude-opus-5',
    'us.anthropic.claude-sonnet-5-v1:0',
    'claude-sonnet-4-5@20250929',
    'openai/claude-opus-5',
  ])('reads %s as anthropic', (modelId) => {
    expect(inferVendor(modelId)).toBe('anthropic')
  })

  it.each([
    'gpt-5',
    'gpt-4o-mini',
    'gpt-3.5-turbo',
    'gpt-6-astra',
    'GPT-5.1',
    'gpt5',
    'gpt4o',
    'chatgpt-4o-latest',
    'gpt-5-chat-latest',
    'o1',
    'o3-mini',
    'o4-mini-2025-04-16',
    'openai/o3',
    'codex-mini-latest',
    'gpt-5-codex',
    'ft:gpt-4o-mini:acme::abc123',
    'azure/gpt-4.1',
  ])('reads %s as openai', (modelId) => {
    expect(inferVendor(modelId)).toBe('openai')
  })

  it('falls back to a namespace when no family is named', () => {
    expect(inferVendor('anthropic/best')).toBe('anthropic')
    expect(inferVendor('openai-default')).toBe('openai')
  })

  it.each([
    ['open-weight models under a GPT name', 'gpt-oss-120b'],
    ['open-weight models under a GPT name, namespaced', 'openai/gpt-oss-20b'],
    ['other labs using GPT in a name', 'gpt4all-j'],
    ['other labs using GPT in a name', 'gpt-neox-20b'],
    ['other labs using GPT in a name', 'gpt-j-6b'],
    ['other labs using o1 in a name', 'marco-o1'],
    ['other labs using o1 in a name', 'skywork-o1-open'],
    ['a bare gpt', 'gpt'],
    ['both vendors', 'claude-via-gpt-5'],
    ['both namespaces', 'anthropic-openai-bridge'],
    ['neither vendor', 'deepseek-chat'],
    ['neither vendor', 'gemini-3-pro'],
    ['nothing', ''],
  ])('has no answer for %s (%s)', (_, modelId) => {
    expect(inferVendor(modelId)).toBeUndefined()
  })

  it('does not read inherited object keys as namespaces', () => {
    expect(inferVendor('constructor')).toBeUndefined()
    expect(inferVendor('__proto__-model')).toBeUndefined()
  })
})
