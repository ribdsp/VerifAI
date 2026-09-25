import { describe, expect, it } from 'vitest'
import { API_KEY_ENV, KEY_FLAG_MESSAGE, parseFlags, UsageError } from '../src/args.js'
import { CHECK_OPTIONS, parseCheckFlags, parseDuration } from '../src/check/flags.js'
import { KEY } from './support/context.js'

const OPTIONS = Object.freeze({
  model: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
} as const)

function usageMessage(run: () => unknown): string {
  try {
    run()
  } catch (error: unknown) {
    if (error instanceof UsageError) {
      return error.message
    }
    throw error
  }
  throw new Error('Expected a UsageError')
}

describe('parseFlags', () => {
  it('reads the flags it was given, frozen', () => {
    const values = parseFlags(['--model', 'gpt-5', '-y'], OPTIONS, 'verifai test')
    expect(values).toEqual({ model: 'gpt-5', yes: true })
    expect(Object.isFrozen(values)).toBe(true)
  })

  it.each([
    ['--api-key', KEY],
    [`--api-key=${KEY}`],
    ['--apikey', KEY],
    ['--KEY', KEY],
    ['-token', KEY],
  ])('refuses a key-shaped flag before parsing anything: %s', (...args) => {
    const message = usageMessage(() => parseFlags(args, OPTIONS, 'verifai test'))
    expect(message).toBe(KEY_FLAG_MESSAGE)
    expect(message).toContain(API_KEY_ENV)
    expect(message).not.toContain(KEY)
  })

  it('names an unknown flag that looks like one', () => {
    expect(usageMessage(() => parseFlags(['--colour'], OPTIONS, 'verifai test'))).toBe(
      'Unknown option --colour. Run `verifai test --help` for the list.',
    )
  })

  it('never names an unknown flag that could be a pasted secret', () => {
    const message = usageMessage(() => parseFlags([`--${KEY}`], OPTIONS, 'verifai test'))
    expect(message).toBe('Unknown option. Run `verifai test --help` for the list.')
    expect(message).not.toContain('clitestkey')
  })

  it('refuses a stray argument with a warning about shell history, not the argument', () => {
    const message = usageMessage(() => parseFlags([KEY], OPTIONS, 'verifai test'))
    expect(message).toContain('rotating it')
    expect(message).not.toContain(KEY)
  })

  it('keeps the first line of a missing-value message, which names only the flag', () => {
    const message = usageMessage(() => parseFlags(['--model'], OPTIONS, 'verifai test'))
    expect(message).toMatch(/--model/)
    expect(message).toMatch(/Run `verifai test --help`\.$/)
    expect(message).not.toContain('\n')
  })
})

describe('parseDuration', () => {
  it.each([
    ['0', 0],
    ['250ms', 250],
    ['90s', 90_000],
    ['10m', 600_000],
    ['1h', 3_600_000],
  ])('reads %s', (text, ms) => {
    expect(parseDuration(text)).toBe(ms)
  })

  it.each(['', '10', '1d', '-1s', '1.5m', 's', '0s0', '1234567890s'])('refuses %j', (text) => {
    expect(parseDuration(text)).toBeUndefined()
  })
})

describe('parseCheckFlags', () => {
  it('defaults everything the buyer left out', () => {
    expect(parseCheckFlags([])).toEqual({
      endpoint: undefined,
      model: undefined,
      vendor: undefined,
      protocol: undefined,
      profile: undefined,
      auth: undefined,
      maxRequests: undefined,
      maxTokens: undefined,
      spreadMs: undefined,
      allowPrivateTargets: false,
      showEndpoint: false,
      format: 'terminal',
      out: undefined,
      yes: false,
      help: false,
    })
  })

  it('reads every flag into its field', () => {
    const flags = parseCheckFlags([
      '--endpoint=https://gateway.example/v1',
      '--model=gpt-5',
      '--vendor=openai',
      '--protocol=openai-chat',
      '--profile=deep',
      '--auth=bearer',
      '--max-requests=50',
      '--max-tokens=0',
      '--spread=10m',
      '--allow-private-targets',
      '--show-endpoint',
      '--format=json',
      '-o',
      'report.json',
      '-y',
    ])
    expect(flags).toMatchObject({
      vendor: 'openai',
      protocol: 'openai-chat',
      profile: 'deep',
      auth: 'bearer',
      maxRequests: 50,
      maxTokens: 0,
      spreadMs: 600_000,
      allowPrivateTargets: true,
      showEndpoint: true,
      format: 'json',
      out: 'report.json',
      yes: true,
    })
  })

  it('takes a flag for every option it declares', () => {
    expect(Object.keys(CHECK_OPTIONS)).toContain('allow-private-targets')
    expect(Object.keys(CHECK_OPTIONS)).not.toContain('api-key')
  })

  it.each([
    [['--vendor', 'google'], '--vendor: expected auto, anthropic or openai'],
    [['--format', 'html'], '--format: expected terminal, markdown or json'],
    [['--auth', 'basic'], '--auth: expected auto, x-api-key or bearer'],
    [['--max-requests', '0'], '--max-requests: expected a whole number from 1 to 2000'],
    [['--max-requests', '2001'], '--max-requests: expected a whole number from 1 to 2000'],
    [['--max-tokens', '1e3'], '--max-tokens: expected a whole number from 0 to 2000000'],
    [['--spread', '2h'], '--spread: expected a duration such as 90s, 10m or 1h, at most 60m'],
    [['--spread', '10'], '--spread: expected a duration such as 90s, 10m or 1h, at most 60m'],
  ])('names the flag and never the value: %j', (args, message) => {
    expect(usageMessage(() => parseCheckFlags(args))).toBe(message)
  })

  it('refuses a profile that does not exist, naming the ones that do', () => {
    expect(usageMessage(() => parseCheckFlags(['--profile', 'extreme']))).toMatch(
      /^--profile: expected quick, .* or paranoid$/,
    )
  })
})
