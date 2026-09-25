import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { API_KEY_ENV } from '../src/args.js'
import { DEBUG_ENV } from '../src/check/command.js'
import { EXIT_CODES } from '../src/exit-codes.js'
import { CHECK_HELP, MAIN_HELP, WEB_HELP } from '../src/help.js'
import type { CliContext } from '../src/io.js'
import { main } from '../src/main.js'
import { USER_AGENT, VERSION } from '../src/version.js'
import { KEY, TARGET_FLAGS, testContext } from './support/context.js'

const INTERNAL = /^verifai: VerifAI failed unexpectedly; nothing was concluded\./

/** A context whose stdout throws, standing in for any failure deep inside a command. */
function breaking(thrown: unknown, env: Readonly<Record<string, string>> = {}) {
  const t = testContext({ env })
  const context: CliContext = {
    ...t.context,
    stdout: {
      isTTY: false,
      write: () => {
        throw thrown
      },
    },
  }
  return { t, context }
}

describe('verifai with no command', () => {
  it('offers the launcher on a terminal', async () => {
    const t = testContext({ interactive: true, answers: ['exit'] })
    expect(await main([], t.context)).toBe(EXIT_CODES.pass)
    expect(t.prompts.asked).toEqual([{ kind: 'select', message: 'What would you like to do?' }])
  })

  it('prints the help on stderr, as a usage error, without one', async () => {
    const t = testContext()
    expect(await main([], t.context)).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toBe(MAIN_HELP)
    expect(t.stdout.text()).toBe('')
  })
})

describe('the launcher', () => {
  it('runs the terminal check', async () => {
    const t = testContext({ interactive: true, answers: ['check', undefined] })
    expect(await main([], t.context)).toBe(EXIT_CODES.cancelled)
    expect(t.prompts.asked.map((ask) => ask.kind)).toEqual(['select', 'text'])
    expect(t.stderr.text()).toContain('Cancelled. No probe was run.')
  })

  it('starts the web UI', async () => {
    const t = testContext({ interactive: true, answers: ['web'] })
    expect(await main([], t.context)).toBe(EXIT_CODES.internal)
    expect(t.stderr.text()).toContain('The web UI is not part of this install.')
  })

  it('runs nothing when cancelled', async () => {
    const t = testContext({ interactive: true, answers: [undefined] })
    expect(await main([], t.context)).toBe(EXIT_CODES.cancelled)
    expect(t.stderr.text()).toBe('Cancelled. Nothing was run.\n')
    expect(t.transport.requests).toEqual([])
  })
})

describe('verifai’s own flags', () => {
  it.each(['--version', '-v'])('prints the version for %s', async (flag) => {
    const t = testContext()
    expect(await main([flag], t.context)).toBe(EXIT_CODES.pass)
    expect(t.stdout.text()).toBe(`${VERSION}\n`)
  })

  it.each(['--help', '-h', 'help'])('prints the help for %s', async (flag) => {
    const t = testContext()
    expect(await main([flag], t.context)).toBe(EXIT_CODES.pass)
    expect(t.stdout.text()).toBe(MAIN_HELP)
  })

  it('refuses a flag it does not know', async () => {
    const t = testContext()
    expect(await main(['--verbose'], t.context)).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toMatch(/^verifai: /)
  })

  it('keeps the version equal to the package’s', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    expect(VERSION).toBe(manifest.version)
  })

  it('names itself and its version as the User-Agent', () => {
    expect(USER_AGENT).toBe(`verifai/${VERSION}`)
  })
})

describe('verifai help', () => {
  it.each([
    ['check', CHECK_HELP],
    ['web', WEB_HELP],
  ])('prints the help of %s', async (topic, help) => {
    const t = testContext()
    expect(await main(['help', topic], t.context)).toBe(EXIT_CODES.pass)
    expect(t.stdout.text()).toBe(help)
  })

  it.each([[['nope']], [['check', 'web']]])('refuses %j', async (rest) => {
    const t = testContext()
    expect(await main(['help', ...rest], t.context)).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toBe('verifai: `verifai help` takes one command: check or web.\n')
  })
})

describe('an unknown command', () => {
  it('is named back when it looks like one', async () => {
    const t = testContext()
    expect(await main(['frobnicate'], t.context)).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toBe(
      'verifai: Unknown command "frobnicate". Run `verifai --help` for the list.\n',
    )
  })

  it('is not repeated when it could be a pasted key', async () => {
    const t = testContext()
    expect(await main([KEY], t.context)).toBe(EXIT_CODES.usage)
    expect(t.stderr.text()).toBe('verifai: Unknown command. Run `verifai --help` for the list.\n')
  })
})

describe('a failure inside VerifAI', () => {
  it('prints a fixed message and never the error’s own', async () => {
    const { t, context } = breaking(new TypeError(`bad ${KEY}`))
    expect(await main(['--version'], context)).toBe(EXIT_CODES.internal)
    expect(t.stderr.text()).toMatch(INTERNAL)
    expect(t.stderr.text()).toContain(`Set ${DEBUG_ENV}=1`)
    expect(t.stderr.text()).not.toContain(KEY)
    expect(t.stderr.text()).not.toContain('TypeError')
  })

  it(`prints the error’s name and frames under ${DEBUG_ENV}, still not its message`, async () => {
    const { t, context } = breaking(new TypeError(`bad ${KEY}`), { [DEBUG_ENV]: '1' })
    expect(await main(['--version'], context)).toBe(EXIT_CODES.internal)
    const lines = t.stderr.text().split('\n')
    expect(lines[0]).toMatch(INTERNAL)
    expect(lines[1]).toBe('TypeError')
    expect(lines[2]).toMatch(/^\s+at /)
    expect(t.stderr.text()).not.toContain(KEY)
  })

  it('names a thrown non-error as such', async () => {
    const { t, context } = breaking(KEY, { [DEBUG_ENV]: '1' })
    expect(await main(['--version'], context)).toBe(EXIT_CODES.internal)
    expect(t.stderr.text()).toContain('\nnon-error thrown\n')
    expect(t.stderr.text()).not.toContain(KEY)
  })

  it('treats an empty debug variable as unset', async () => {
    const { t, context } = breaking(new TypeError('bad'), { [DEBUG_ENV]: '' })
    await main(['--version'], context)
    expect(t.stderr.text().split('\n').filter(Boolean)).toHaveLength(1)
  })
})

describe('verifai check through main', () => {
  it('runs with the key from the environment and keeps it out of the report', async () => {
    const t = testContext({ env: { [API_KEY_ENV]: KEY } })
    const code = await main(['check', ...TARGET_FLAGS, '--yes', '--format', 'json'], t.context)
    expect([EXIT_CODES.pass, EXIT_CODES.caution, EXIT_CODES.fail]).toContain(code)
    expect(t.stdout.text()).not.toContain(KEY)
  })
})
