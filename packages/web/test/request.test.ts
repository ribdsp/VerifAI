import { MAX_SPREAD_MS } from '@verifai/core'
import { describe, expect, it } from 'vitest'
import {
  buildCheckRequest,
  type CheckFormValues,
  initialFormValues,
  problemsByField,
} from '../src/lib/request'
import { OPTIONS } from './fixtures'

// Assembled, so the secret scan does not read a test value as a leaked key.
const API_KEY = ['sk', 'test', 'DO', 'NOT', 'LEAK', '0123456789'].join('-')

function valuesWith(overrides: Partial<CheckFormValues> = {}): CheckFormValues {
  return {
    ...initialFormValues(OPTIONS),
    endpoint: ' https://api.example.com ',
    model: ' claude-sonnet-5 ',
    ...overrides,
  }
}

describe('initialFormValues', () => {
  it('starts from the daemon defaults, blank budgets and nothing opted in', () => {
    expect(initialFormValues(OPTIONS)).toEqual({
      endpoint: '',
      model: '',
      vendor: 'auto',
      protocol: 'auto',
      profile: 'standard',
      auth: 'auto',
      maxRequests: '',
      maxTokens: '',
      spreadMinutes: '',
      allowPrivateTargets: false,
      showEndpoint: false,
    })
  })
})

describe('buildCheckRequest', () => {
  it('trims the text fields and leaves out an empty API key', () => {
    const built = buildCheckRequest(valuesWith(), '   ')

    expect(built).toEqual({
      ok: true,
      request: {
        endpoint: 'https://api.example.com',
        model: 'claude-sonnet-5',
        vendor: 'auto',
        protocol: 'auto',
        profile: 'standard',
      },
    })
  })

  it('carries a trimmed API key when one is given', () => {
    const built = buildCheckRequest(valuesWith(), ` ${API_KEY}\n`)

    expect(built.ok && built.request.apiKey).toBe(API_KEY)
  })

  it('parses budgets as whole numbers and the spread as minutes', () => {
    const built = buildCheckRequest(
      valuesWith({ maxRequests: ' 50 ', maxTokens: '0', spreadMinutes: '1.5' }),
      '',
    )

    expect(built.ok && built.request).toMatchObject({
      maxRequests: 50,
      maxTokens: 0,
      spreadMs: 90_000,
    })
  })

  it('sends the key header only when one is chosen', () => {
    const auto = buildCheckRequest(valuesWith(), '')
    const bearer = buildCheckRequest(valuesWith({ auth: 'bearer' }), '')

    expect(auto.ok && 'auth' in auto.request).toBe(false)
    expect(bearer.ok && bearer.request.auth).toBe('bearer')
  })

  it('sends the opt-ins only when they are on', () => {
    const off = buildCheckRequest(valuesWith(), '')
    const on = buildCheckRequest(valuesWith({ allowPrivateTargets: true, showEndpoint: true }), '')

    expect(off.ok && 'allowPrivateTargets' in off.request).toBe(false)
    expect(on.ok && on.request).toMatchObject({ allowPrivateTargets: true, showEndpoint: true })
  })

  it('names the field of each number it cannot read', () => {
    const built = buildCheckRequest(
      valuesWith({ maxRequests: '1e3', maxTokens: '-4', spreadMinutes: 'soon' }),
      '',
    )

    expect(built).toEqual({
      ok: false,
      problems: [
        'maxRequests: expected a whole number',
        'maxTokens: expected a whole number',
        'spreadMs: expected a number of minutes',
      ],
    })
  })

  it('refuses a spread past the daemon limit', () => {
    const built = buildCheckRequest(
      valuesWith({ spreadMinutes: String(MAX_SPREAD_MS / 60_000 + 1) }),
      '',
    )

    expect(built.ok).toBe(false)
    expect(!built.ok && built.problems[0]).toMatch(/^spreadMs: expected at most \d+ minutes$/)
  })

  it('applies core schema problems, once each', () => {
    const built = buildCheckRequest(valuesWith({ endpoint: '', model: '  ' }), '')

    expect(built.ok).toBe(false)
    const problems = built.ok ? [] : built.problems
    expect(problems.some((problem) => problem.startsWith('endpoint:'))).toBe(true)
    expect(problems.some((problem) => problem.startsWith('model:'))).toBe(true)
    expect(new Set(problems).size).toBe(problems.length)
  })

  it('never quotes the API key in a problem', () => {
    const built = buildCheckRequest(valuesWith({ endpoint: '' }), `${API_KEY}${'x'.repeat(4096)}`)

    expect(built.ok).toBe(false)
    expect(JSON.stringify(built)).not.toContain(API_KEY)
  })
})

describe('problemsByField', () => {
  it('files each problem under the field it names, without the prefix', () => {
    expect(
      problemsByField([
        'endpoint: expected a URL',
        'maxRequests: expected a whole number',
        'endpoint: expected https',
      ]),
    ).toEqual({
      endpoint: ['expected a URL', 'expected https'],
      maxRequests: ['expected a whole number'],
    })
  })

  it('files anything else under the form, as written', () => {
    expect(
      problemsByField(['unknown field: not part of the request', 'body: invalid', 'no colon']),
    ).toEqual({
      form: ['unknown field: not part of the request', 'body: invalid', 'no colon'],
    })
  })
})
