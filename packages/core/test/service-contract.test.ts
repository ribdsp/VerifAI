import { describe, expect, it } from 'vitest'
import { PROFILES, profileDefinition } from '../src/planner/profiles.js'
import {
  AUTH_CHOICES,
  CHECK_STATES,
  FINAL_CHECK_STATES,
  PROTOCOL_CHOICES,
  parseCheckRequest,
} from '../src/service/contract.js'

const VALID = Object.freeze({
  endpoint: 'https://api.example.com/v1',
  model: 'claude-opus-5-5',
  vendor: 'auto',
  protocol: 'auto',
  profile: 'standard',
})

const KEY = ['sk', 'ant', 'contract', 'fixture', 'value'].join('-')

describe('parseCheckRequest', () => {
  it('accepts the minimal request and freezes it', () => {
    const parsed = parseCheckRequest(VALID)

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value).toEqual(VALID)
      expect(Object.isFrozen(parsed.value)).toBe(true)
    }
  })

  it('accepts every optional field within its bounds', () => {
    const parsed = parseCheckRequest({
      ...VALID,
      apiKey: KEY,
      maxRequests: 10,
      maxTokens: 0,
      spreadMs: 60_000,
      allowPrivateTargets: true,
      showEndpoint: false,
      auth: 'bearer',
    })

    expect(parsed.ok).toBe(true)
  })

  it('refuses an auth scheme it does not know, naming the choices', () => {
    const parsed = parseCheckRequest({ ...VALID, auth: 'basic' })

    expect(parsed).toEqual({
      ok: false,
      problems: ['auth: expected ("auto" | "x-api-key" | "bearer")'],
    })
  })

  it('names the field and what it expected, never the value it received', () => {
    const parsed = parseCheckRequest({ ...VALID, apiKey: 42, vendor: KEY, maxRequests: 1.5 })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.problems.some((problem) => problem.startsWith('apiKey:'))).toBe(true)
      expect(parsed.problems.some((problem) => problem.startsWith('vendor:'))).toBe(true)
      expect(parsed.problems.some((problem) => problem.startsWith('maxRequests:'))).toBe(true)
      expect(parsed.problems.join('\n')).not.toContain(KEY)
      expect(parsed.problems.join('\n')).not.toContain('42')
    }
  })

  it('refuses an unknown field without naming it', () => {
    const parsed = parseCheckRequest({ ...VALID, [KEY]: true })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.problems).toEqual(['unknown field: not part of the request'])
    }
  })

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'x', [], 1]) {
      const parsed = parseCheckRequest(body)
      expect(parsed.ok).toBe(false)
    }
  })

  it('refuses an oversized endpoint and an empty model', () => {
    const parsed = parseCheckRequest({
      ...VALID,
      endpoint: `https://${'a'.repeat(3000)}`,
      model: '',
    })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.problems).toHaveLength(2)
    }
  })
})

describe('the contract vocabularies', () => {
  it('offers auto before the three protocols', () => {
    expect(PROTOCOL_CHOICES.values).toEqual([
      'auto',
      'anthropic-messages',
      'openai-chat',
      'openai-responses',
    ])
  })

  it('offers auto before the two ways a key can travel', () => {
    expect(AUTH_CHOICES.values).toEqual(['auto', 'x-api-key', 'bearer'])
  })

  it('treats every state but prepared and running as final', () => {
    expect(CHECK_STATES.values.filter((state) => !FINAL_CHECK_STATES.has(state))).toEqual([
      'prepared',
      'running',
    ])
  })
})

describe('profileDefinition', () => {
  it('runs Group F everywhere but quick, and spreads it only under paranoid', () => {
    const quick = profileDefinition('quick')
    const paranoid = profileDefinition('paranoid')

    expect(quick.groups).toEqual(['A'])
    expect(quick.draws).toBe(0)
    expect(profileDefinition('standard').groups).toEqual(['A', 'B', 'C', 'F'])
    expect(paranoid.shuffle).toBe(true)
    expect(paranoid.spreadMs).toBe(600_000)
    for (const profile of PROFILES.values) {
      expect(Object.isFrozen(profileDefinition(profile).groups)).toBe(true)
    }
  })

  it('refuses a name that is not a profile', () => {
    expect(() => profileDefinition('turbo' as never)).toThrow(TypeError)
  })
})
