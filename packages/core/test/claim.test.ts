import { describe, expect, it } from 'vitest'
import { documentedModelName } from '../src/adapters/claim.js'

describe('documentedModelName', () => {
  it('leaves a documented name as it is, alias or snapshot', () => {
    for (const id of [
      'claude-opus-5-5',
      'claude-opus-4-5',
      'claude-haiku-4-5-20251001',
      'gpt-5.4',
      'gpt-4o-mini-2024-07-18',
    ]) {
      expect(documentedModelName(id)).toBe(id)
    }
  })

  it("drops a gateway's namespace", () => {
    expect(documentedModelName('reseller/claude-sonnet-5')).toBe('claude-sonnet-5')
    expect(documentedModelName('reseller/gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(documentedModelName('openrouter/anthropic/claude-opus-5')).toBe('claude-opus-5')
  })

  it('writes a Claude version with the dash the API uses', () => {
    expect(documentedModelName('reseller/claude-opus-4.6')).toBe('claude-opus-4-6')
    expect(documentedModelName('claude-opus-4.8')).toBe('claude-opus-4-8')
    expect(documentedModelName('claude-opus-4.5')).toBe('claude-opus-4-5')
  })

  it("drops a platform's vendor prefix", () => {
    expect(documentedModelName('openai-gpt-5.4')).toBe('gpt-5.4')
    expect(documentedModelName('openai-gpt-5-nano')).toBe('gpt-5-nano')
    expect(documentedModelName('openai-1p-gpt-5.6-terra')).toBe('gpt-5.6-terra')
  })

  it('ignores case the catalog does not use', () => {
    expect(documentedModelName('Claude-Opus-4.7')).toBe('claude-opus-4-7')
  })

  it('keeps the dots in a GPT version, where they are the documented spelling', () => {
    expect(documentedModelName('reseller/gpt-5.5')).toBe('gpt-5.5')
  })

  it('returns an undocumented name unchanged', () => {
    for (const id of ['reseller/llama-4-maverick', 'claude-9-9', 'gpt-oss-120b', 'openai-gpt-99']) {
      expect(documentedModelName(id)).toBe(id)
    }
  })

  it("looks only in the chosen vendor's catalog", () => {
    expect(documentedModelName('reseller/gpt-5.5', 'anthropic')).toBe('reseller/gpt-5.5')
    expect(documentedModelName('reseller/claude-opus-4.6', 'anthropic')).toBe('claude-opus-4-6')
    expect(documentedModelName('reseller/claude-opus-4.6', 'openai')).toBe(
      'reseller/claude-opus-4.6',
    )
  })
})
