/**
 * A `CliContext` the test controls: captured streams, prompts that answer
 * from a script, and a transport that never leaves the process.
 */

import type { Transport } from '@verifai/core'
import type { AnyProbe } from '../../../core/src/probes/types.js'
import { testProbe } from '../../../core/test/fakes/probes.js'
import {
  type Answer,
  type FakeTransport,
  fakeTransport,
  jsonResponse,
} from '../../../core/test/fakes/transport.js'
import type { CliContext, Output, Prompts, Spinner } from '../../src/io.js'

/** Built from parts so the no-secrets scan does not read it as a real key. */
export const KEY = ['sk', 'ant', 'api03', 'clitestkey0123456789abcdefghij'].join('-')

export const CATALOGUE: readonly AnyProbe[] = Object.freeze([
  testProbe('conformance/test/free'),
  testProbe('accounting/test/keyed', { group: 'B', needsKey: true }),
])

export const TARGET_FLAGS: readonly string[] = Object.freeze([
  '--endpoint',
  'https://gateway.example/v1',
  '--model',
  'claude-opus-5-5',
  '--vendor',
  'anthropic',
  '--protocol',
  'anthropic-messages',
])

export interface CapturedOutput extends Output {
  readonly text: () => string
}

export function captured(isTTY = false): CapturedOutput {
  let text = ''
  return Object.freeze({
    write: (chunk: string) => {
      text += chunk
    },
    isTTY,
    text: () => text,
  })
}

export type PromptKind = 'select' | 'text' | 'password' | 'confirm'

export interface Asked {
  readonly kind: PromptKind
  readonly message: string
}

export interface ScriptedPrompts extends Prompts {
  readonly asked: readonly Asked[]
  readonly notes: readonly string[]
  readonly spinnerLines: readonly string[]
}

/** Each prompt takes the next answer; running out of answers is a test bug. */
export function scriptedPrompts(answers: readonly unknown[] = []): ScriptedPrompts {
  const queue = [...answers]
  const asked: Asked[] = []
  const notes: string[] = []
  const spinnerLines: string[] = []
  const next = <T>(kind: PromptKind, message: string): Promise<T> => {
    asked.push({ kind, message })
    if (queue.length === 0) {
      throw new Error(`No scripted answer for ${kind} "${message}"`)
    }
    return Promise.resolve(queue.shift() as T)
  }
  const spinner = (): Spinner =>
    Object.freeze({
      start: (message: string) => void spinnerLines.push(`start ${message}`),
      message: (message: string) => void spinnerLines.push(`message ${message}`),
      stop: (message: string) => void spinnerLines.push(`stop ${message}`),
    })
  return {
    get asked() {
      return Object.freeze([...asked])
    },
    get notes() {
      return Object.freeze([...notes])
    },
    get spinnerLines() {
      return Object.freeze([...spinnerLines])
    },
    intro: () => undefined,
    outro: () => undefined,
    note: (message: string) => void notes.push(message),
    select: (message) => next('select', message),
    text: async (message, options) => {
      const value = await next<string | undefined>('text', message)
      // A real prompt would not let an invalid value through; say so loudly.
      const problem = value === undefined ? undefined : options?.validate?.(value)
      if (problem !== undefined) {
        throw new Error(`Scripted answer for "${message}" fails validation: ${problem}`)
      }
      return value
    },
    password: (message) => next('password', message),
    confirm: (message) => next('confirm', message),
    spinner,
  }
}

export interface ContextOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly interactive?: boolean
  readonly answers?: readonly unknown[]
  readonly answer?: Answer
  readonly webRoot?: string
  readonly opens?: boolean
  readonly now?: () => number
  readonly stdoutIsTTY?: boolean
}

export interface TestContext {
  readonly context: CliContext
  readonly stdout: CapturedOutput
  readonly stderr: CapturedOutput
  readonly prompts: ScriptedPrompts
  readonly transport: FakeTransport
  /** The `allowPrivateTargets` each transport was created with. */
  readonly transports: readonly boolean[]
  readonly files: ReadonlyMap<string, string>
  readonly opened: readonly string[]
  readonly abort: () => void
}

export function testContext(options: ContextOptions = {}): TestContext {
  const stdout = captured(options.stdoutIsTTY ?? false)
  const stderr = captured()
  const prompts = scriptedPrompts(options.answers)
  const transport = fakeTransport(options.answer ?? (() => jsonResponse(200, { ok: true })))
  const transports: boolean[] = []
  const files = new Map<string, string>()
  const opened: string[] = []
  const interrupt = new AbortController()
  const context: CliContext = {
    env: options.env ?? {},
    stdout,
    stderr,
    interactive: options.interactive ?? false,
    prompts,
    createTransport: (allowPrivateTargets: boolean): Transport => {
      transports.push(allowPrivateTargets)
      return transport
    },
    writeFile: async (path, content) => {
      files.set(path, content)
    },
    openBrowser: async (url) => {
      opened.push(url)
      return options.opens ?? true
    },
    signal: interrupt.signal,
    webRoot: options.webRoot ?? '/nonexistent/verifai-web',
    ...(options.now === undefined ? {} : { now: options.now }),
    checkEnvironment: { catalogue: CATALOGUE },
  }
  return {
    context,
    stdout,
    stderr,
    prompts,
    transport,
    transports,
    files,
    opened,
    abort: () => interrupt.abort(),
  }
}
