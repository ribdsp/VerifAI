import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createClackPrompts } from '../src/prompts.js'

const ENTER = '\r'
const CTRL_C = '\x03'
const DOWN = '\x1b[B'

/** Prompts on in-memory streams: keys are typed into `input`, the drawing lands in `drawn()`. */
function streams() {
  const input = new PassThrough()
  const output = new PassThrough()
  let drawn = ''
  output.on('data', (chunk: Buffer) => {
    drawn += chunk.toString('utf8')
  })
  const type = (...keys: string[]) => {
    for (const key of keys) {
      setImmediate(() => input.write(key))
    }
  }
  return { prompts: createClackPrompts(input, output), type, drawn: () => drawn }
}

describe('createClackPrompts', () => {
  it('returns what was typed', async () => {
    const s = streams()
    const answer = s.prompts.text('Endpoint', { placeholder: 'https://gateway.example/v1' })
    s.type('abc', ENTER)
    expect(await answer).toBe('abc')
    expect(s.drawn()).toContain('Endpoint')
  })

  it('runs the validation, and shows its problem until it passes', async () => {
    const s = streams()
    const answer = s.prompts.text('Model', {
      validate: (value) => (value === 'ok' ? undefined : 'not ok'),
    })
    s.type('no', ENTER)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(s.drawn()).toContain('not ok')
    s.type('\x7f', '\x7f', 'ok', ENTER)
    expect(await answer).toBe('ok')
  })

  it('turns every cancel into undefined', async () => {
    const s = streams()
    const text = s.prompts.text('Endpoint')
    s.type(CTRL_C)
    expect(await text).toBeUndefined()

    const password = s.prompts.password('Key')
    s.type(CTRL_C)
    expect(await password).toBeUndefined()

    const confirm = s.prompts.confirm('Run?')
    s.type(CTRL_C)
    expect(await confirm).toBeUndefined()

    const select = s.prompts.select('Pick', [{ value: 'a', label: 'A' }])
    s.type(CTRL_C)
    expect(await select).toBeUndefined()
  })

  it('masks a password and returns it', async () => {
    const s = streams()
    const answer = s.prompts.password('Key')
    s.type('hunter2', ENTER)
    expect(await answer).toBe('hunter2')
    expect(s.drawn()).not.toContain('hunter2')
  })

  it('confirms, and picks from a list starting at the initial choice', async () => {
    const s = streams()
    const confirm = s.prompts.confirm('Run?')
    s.type(ENTER)
    expect(await confirm).toBe(true)

    const select = s.prompts.select(
      'Pick',
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', hint: 'the second' },
        { value: 'c', label: 'C' },
      ],
      'b',
    )
    s.type(DOWN, ENTER)
    expect(await select).toBe('c')

    const first = s.prompts.select('Pick', [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ])
    s.type(ENTER)
    expect(await first).toBe('a')
  })

  it('draws the intro, notes, the outro and a spinner on its own stream', () => {
    const s = streams()
    s.prompts.intro('VerifAI')
    s.prompts.note('Two probes', 'Estimate')
    const spinner = s.prompts.spinner()
    spinner.start('Probing')
    spinner.message('Still probing')
    spinner.stop('Done')
    s.prompts.outro('Bye')
    for (const text of ['VerifAI', 'Two probes', 'Estimate', 'Done', 'Bye']) {
      expect(s.drawn()).toContain(text)
    }
  })
})
