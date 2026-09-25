import { describe, expect, it } from 'vitest'
import { failure, jsonResponse } from '../../core/test/fakes/transport.js'
import { API_KEY_ENV } from '../src/args.js'
import { DEBUG_ENV, runCheck } from '../src/check/command.js'
import { EXIT_CODES, exitCodeFor } from '../src/exit-codes.js'
import { CHECK_HELP } from '../src/help.js'
import { main } from '../src/main.js'
import { KEY, TARGET_FLAGS, testContext } from './support/context.js'

const WITH_KEY = Object.freeze({ [API_KEY_ENV]: KEY })

function reportOf(text: string) {
  return JSON.parse(text) as { verdict: { headline: 'pass' | 'caution' | 'fail' } }
}

describe('verifai check without a terminal', () => {
  it('prints the estimate, runs, and writes only the report to stdout', async () => {
    const t = testContext({ env: WITH_KEY })
    const code = await runCheck([...TARGET_FLAGS, '--yes', '--format', 'json'], t.context)

    const report = reportOf(t.stdout.text())
    expect(code).toBe(exitCodeFor(report.verdict.headline))
    expect(t.stderr.text()).toContain(
      'Target     claude-opus-5-5 (Anthropic) over anthropic-messages',
    )
    expect(t.stderr.text()).toContain('Running 2 probes...')
    expect(t.stderr.text()).toMatch(/Verdict: /)
    expect(t.transport.requests.length).toBeGreaterThan(0)
    expect(t.transports).toEqual([false])
  })

  it('keeps the key out of everything it prints', async () => {
    const t = testContext({ env: WITH_KEY })
    await runCheck([...TARGET_FLAGS, '--yes', '--format', 'markdown'], t.context)
    expect(t.stdout.text()).not.toContain(KEY)
    expect(t.stderr.text()).not.toContain(KEY)
    // It was sent, though: to the endpoint, and nowhere else.
    expect(JSON.stringify(t.transport.requests)).toContain(KEY)
  })

  it('writes the report to --out and says where', async () => {
    const t = testContext({ env: WITH_KEY })
    await runCheck([...TARGET_FLAGS, '-y', '--format', 'json', '-o', 'report.json'], t.context)
    expect(t.stdout.text()).toBe('')
    expect(reportOf(t.files.get('report.json') ?? '')).toHaveProperty('verdict')
    expect(t.stderr.text()).toContain('Report written to report.json')
  })

  it('renders the terminal report without colour when stdout is not a terminal', async () => {
    const t = testContext({ env: WITH_KEY })
    await runCheck([...TARGET_FLAGS, '-y'], t.context)
    expect(t.stdout.text()).not.toContain('\u001b[')
    expect(t.stdout.text().length).toBeGreaterThan(0)
    // The terminal report carries its own verdict line.
    expect(t.stderr.text()).not.toMatch(/Verdict: /)
  })

  it('colours the terminal report only on a terminal without NO_COLOR', async () => {
    const coloured = testContext({ env: WITH_KEY, stdoutIsTTY: true })
    await runCheck([...TARGET_FLAGS, '-y'], coloured.context)
    expect(coloured.stdout.text()).toContain('\u001b[')

    // biome-ignore lint/style/useNamingConvention: the no-color.org variable.
    const plain = testContext({ env: { ...WITH_KEY, NO_COLOR: '1' }, stdoutIsTTY: true })
    await runCheck([...TARGET_FLAGS, '-y'], plain.context)
    expect(plain.stdout.text()).not.toContain('\u001b[')
  })

  it('runs without a key, warning of what that leaves out', async () => {
    const t = testContext()
    await runCheck([...TARGET_FLAGS, '-y', '--format', 'json'], t.context)
    expect(t.stderr.text()).toContain('Left out:')
    expect(t.stderr.text()).toContain('- No API key:')
    expect(JSON.stringify(t.transport.requests)).not.toContain('x-api-key')
  })

  it('refuses to spend without --yes, before sending anything', async () => {
    const t = testContext({ env: WITH_KEY })
    const code = await main(['check', ...TARGET_FLAGS], t.context)
    expect(code).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toContain('needs --yes')
    expect(t.transport.requests).toHaveLength(0)
  })

  it('needs --endpoint and --model', async () => {
    const t = testContext({ env: WITH_KEY })
    const code = await main(['check', '--model', 'gpt-5', '--yes'], t.context)
    expect(code).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toContain('needs --endpoint and --model')
  })

  it('refuses a request that fails validation, naming the field', async () => {
    const t = testContext({ env: WITH_KEY })
    const code = await main(
      ['check', '--endpoint', 'https://gateway.example/v1', '--model=', '-y'],
      t.context,
    )
    expect(code).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toMatch(/^verifai: model: /)
    expect(t.transport.requests).toHaveLength(0)
  })

  it('refuses an endpoint core rejects as the input’s fault, with exit 2', async () => {
    const t = testContext({ env: WITH_KEY })
    const flags = [...TARGET_FLAGS.slice(2), '--endpoint', 'ftp://gateway.example/v1', '-y']
    expect(await runCheck(flags, t.context)).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toContain('The check cannot run')
    expect(t.stderr.text()).toContain('endpoint: expected an http or https URL')
    expect(t.transport.requests).toHaveLength(0)
  })

  it('refuses a private address unless the run allows it', async () => {
    const flags = [...TARGET_FLAGS.slice(2), '--endpoint', 'http://127.0.0.1:8080/v1', '-y']
    const refused = testContext({ env: WITH_KEY })
    expect(await runCheck(flags, refused.context)).toBe(EXIT_CODES.usage)
    expect(refused.stderr.text()).toContain('allow private targets')

    const allowed = testContext({ env: WITH_KEY })
    await runCheck([...flags, '--allow-private-targets', '--format', 'json'], allowed.context)
    expect(allowed.transports).toEqual([true])
    expect(allowed.stdout.text()).toContain('"privateTargetsAllowed": true')
  })

  it('stops with exit 3 when the endpoint refuses the key', async () => {
    const t = testContext({ env: WITH_KEY, answer: () => jsonResponse(401, { type: 'error' }) })
    const code = await runCheck([...TARGET_FLAGS, '-y'], t.context)
    expect(code).toBe(EXIT_CODES.stopped)
    expect(t.stdout.text()).toBe('')
    expect(t.stderr.text()).toContain('Stopped')
  })

  it('sends the key as a bearer token with --auth bearer', async () => {
    const t = testContext({ env: WITH_KEY })
    await runCheck([...TARGET_FLAGS, '--auth', 'bearer', '-y'], t.context)
    const sent = JSON.stringify(t.transport.requests)
    expect(sent).toContain(`Bearer ${KEY}`)
    expect(sent.toLowerCase()).not.toContain('x-api-key')
    expect(t.stderr.text()).toMatch(/Key\s+sent as bearer token/)
  })

  it('suggests --auth bearer when the Messages API refuses the key', async () => {
    const t = testContext({ env: WITH_KEY, answer: () => jsonResponse(401, { type: 'error' }) })
    await runCheck([...TARGET_FLAGS, '-y'], t.context)
    expect(t.stderr.text()).toContain('--auth bearer')
  })

  it('stops with exit 3 when the endpoint cannot be reached', async () => {
    const t = testContext({ env: WITH_KEY, answer: () => failure('connection-failed') })
    expect(await runCheck([...TARGET_FLAGS, '-y'], t.context)).toBe(EXIT_CODES.stopped)
  })

  it('fails closed with exit 1 on its own bug, with the detail only under VERIFAI_DEBUG', async () => {
    const broken = () => {
      throw new Error(`clock broke near ${KEY}`)
    }
    const quiet = testContext({ env: WITH_KEY, now: broken })
    expect(await runCheck([...TARGET_FLAGS, '-y'], quiet.context)).toBe(EXIT_CODES.internal)
    const quietText = quiet.stderr.text()

    const debug = testContext({ env: { ...WITH_KEY, [DEBUG_ENV]: '1' }, now: broken })
    expect(await runCheck([...TARGET_FLAGS, '-y'], debug.context)).toBe(EXIT_CODES.internal)
    expect(debug.stderr.text().length).toBeGreaterThan(quietText.length)
    expect(debug.stderr.text()).not.toContain(KEY)
  })

  it('reports a run cancelled by Ctrl+C as cancelled, with no report', async () => {
    const t = testContext({ env: WITH_KEY })
    const flags = [...TARGET_FLAGS, '-y']
    const running = runCheck(flags, {
      ...t.context,
      createTransport: () => ({
        send: async () => {
          t.abort()
          return jsonResponse(200, { ok: true })
        },
      }),
    })
    expect(await running).toBe(EXIT_CODES.cancelled)
    expect(t.stdout.text()).toBe('')
    expect(t.stderr.text()).toMatch(/Cancelled/)
  })

  it('prints its help to stdout', async () => {
    const t = testContext()
    expect(await runCheck(['--help'], t.context)).toBe(EXIT_CODES.pass)
    expect(t.stdout.text()).toBe(CHECK_HELP)
  })
})

describe('verifai check on a terminal', () => {
  it('asks for what the flags left out, shows the estimate, and asks before spending', async () => {
    const t = testContext({
      interactive: true,
      answers: [
        'https://gateway.example/v1',
        'claude-opus-5-5',
        'anthropic',
        'anthropic-messages',
        'quick',
        ` ${KEY} `,
        true,
      ],
    })
    const code = await runCheck(['--format', 'json'], t.context)

    expect(t.prompts.asked.map((ask) => ask.kind)).toEqual([
      'text',
      'text',
      'select',
      'select',
      'select',
      'password',
      'confirm',
    ])
    expect(t.prompts.notes[0]).toContain('Profile    quick')
    expect(t.prompts.spinnerLines).toContain('stop Planned')
    expect(code).toBe(exitCodeFor(reportOf(t.stdout.text()).verdict.headline))
    // The trimmed key is the one that went out.
    expect(JSON.stringify(t.transport.requests)).toContain(`"${KEY}"`)
  })

  it('takes the key from the environment instead of asking', async () => {
    const t = testContext({ interactive: true, env: WITH_KEY, answers: [true] })
    await runCheck([...TARGET_FLAGS, '--format', 'json'], t.context)
    expect(t.prompts.asked.map((ask) => ask.kind)).toEqual(['confirm'])
  })

  it('treats an empty key as none', async () => {
    const t = testContext({ interactive: true, answers: ['   ', true] })
    await runCheck([...TARGET_FLAGS, '--format', 'json'], t.context)
    expect(t.prompts.notes[0]).toContain('- No API key:')
  })

  it.each([
    ['the endpoint', [undefined]],
    ['the model', ['https://gateway.example/v1', undefined]],
    ['the vendor', ['https://gateway.example/v1', 'gpt-5', undefined]],
    ['the protocol', ['https://gateway.example/v1', 'gpt-5', 'openai', undefined]],
    ['the profile', ['https://gateway.example/v1', 'gpt-5', 'openai', 'openai-chat', undefined]],
    [
      'the key',
      ['https://gateway.example/v1', 'gpt-5', 'openai', 'openai-chat', 'quick', undefined],
    ],
  ])('cancels at %s with exit 130 and nothing sent', async (_field, answers) => {
    const t = testContext({ interactive: true, answers })
    expect(await runCheck([], t.context)).toBe(EXIT_CODES.cancelled)
    expect(t.stderr.text()).toContain('Cancelled. No probe was run.')
    expect(t.transport.requests).toHaveLength(0)
  })

  it('sends nothing when the estimate is declined', async () => {
    const t = testContext({ interactive: true, env: WITH_KEY, answers: [false] })
    expect(await runCheck(TARGET_FLAGS, t.context)).toBe(EXIT_CODES.cancelled)
    expect(t.transport.requests).toHaveLength(0)
  })

  it('skips the confirmation with --yes', async () => {
    const t = testContext({ interactive: true, env: WITH_KEY })
    await runCheck([...TARGET_FLAGS, '--yes', '--format', 'json'], t.context)
    expect(t.prompts.asked).toEqual([])
  })
})
