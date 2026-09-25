/**
 * `Prompts` on `@clack/prompts`, drawn on stderr so stdout stays the report's.
 *
 * clack resolves a cancelled prompt to a symbol; here every cancel becomes
 * `undefined`, so a command checks one thing and never imports clack itself.
 */

import type { Readable, Writable } from 'node:stream'
import * as clack from '@clack/prompts'
import type { Choice, Prompts, Spinner, TextOptions } from './io.js'

function settled<T>(value: T | symbol): T | undefined {
  return clack.isCancel(value) ? undefined : (value as T)
}

export function createClackPrompts(input: Readable, output: Writable): Prompts {
  const common = { input, output }
  return Object.freeze({
    intro: (title: string) => clack.intro(title, common),
    outro: (message: string) => clack.outro(message, common),
    note: (message: string, title: string) => clack.note(message, title, common),
    select: async <T extends string>(
      message: string,
      choices: readonly Choice<T>[],
      initial?: T,
    ): Promise<T | undefined> => {
      const options = choices.map((choice) => ({
        value: choice.value,
        label: choice.label,
        ...(choice.hint === undefined ? {} : { hint: choice.hint }),
      }))
      // clack's option type is conditional on the value type, which a generic cannot satisfy.
      const picked = await clack.select<T>({
        ...common,
        message,
        options: options as Parameters<typeof clack.select<T>>[0]['options'],
        ...(initial === undefined ? {} : { initialValue: initial }),
      })
      return settled<T>(picked)
    },
    text: async (message: string, options: TextOptions = {}) => {
      const { placeholder, validate } = options
      const typed = await clack.text({
        ...common,
        message,
        ...(placeholder === undefined ? {} : { placeholder }),
        ...(validate === undefined ? {} : { validate: (value) => validate(value ?? '') }),
      })
      return settled<string>(typed)
    },
    password: async (message: string) =>
      settled<string>(await clack.password({ ...common, message })),
    confirm: async (message: string) =>
      settled<boolean>(await clack.confirm({ ...common, message })),
    spinner: (): Spinner => {
      const spin = clack.spinner({ output })
      return Object.freeze({
        start: (message: string) => spin.start(message),
        message: (message: string) => spin.message(message),
        stop: (message: string) => spin.stop(message),
      })
    },
  })
}
