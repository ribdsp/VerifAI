/**
 * Strict flag parsing with messages that never repeat a value.
 *
 * `node:util`'s `parseArgs` rather than a CLI framework: it refuses unknown
 * flags and stray arguments, and it never turns `--model 4` into a number.
 * Its own messages are replaced where they would echo what was typed, since
 * what was typed may be a key pasted into the wrong place.
 */

import { type ParseArgsConfig, parseArgs } from 'node:util'

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export type OptionsConfig = NonNullable<ParseArgsConfig['options']>

export type FlagValues<O extends OptionsConfig> = {
  readonly [K in keyof O]?: O[K] extends { readonly type: 'boolean' } ? boolean : string
}

export const API_KEY_ENV = 'VERIFAI_API_KEY'

/** Flag names a buyer might reach for to pass the key. */
const KEY_FLAGS: ReadonlySet<string> = new Set(['api-key', 'apikey', 'key', 'token'])

export const KEY_FLAG_MESSAGE = `VerifAI does not take the API key as a flag: a flag lands in your shell history and in the process list. Set ${API_KEY_ENV}, or leave it unset to be asked.`

/** A flag is named back only when it looks like a flag, never like a pasted secret. */
const FLAG_NAME = /^[a-z][a-z-]{0,39}$/

function nameOf(arg: string): string {
  return arg.replace(/^--?/, '').split('=')[0] ?? ''
}

function knownNames(options: OptionsConfig): ReadonlySet<string> {
  return new Set(
    Object.entries(options).flatMap(([name, option]) =>
      option.short === undefined ? [name] : [name, option.short],
    ),
  )
}

function isFlag(arg: string): boolean {
  return arg.startsWith('-') && arg !== '-' && arg !== '--'
}

function unknownOption(args: readonly string[], options: OptionsConfig, help: string): UsageError {
  const known = knownNames(options)
  const name = args
    .filter(isFlag)
    .map(nameOf)
    .find((candidate) => !known.has(candidate))
  const named = name !== undefined && FLAG_NAME.test(name) ? ` --${name}` : ''
  return new UsageError(`Unknown option${named}. Run \`${help}\` for the list.`)
}

function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

function usageErrorOf(
  error: unknown,
  args: readonly string[],
  options: OptionsConfig,
  command: string,
): Error {
  const help = `${command} --help`
  switch (codeOf(error)) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return unknownOption(args, options, help)
    case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL':
      return new UsageError(
        `\`${command}\` takes every value as a --flag. If you pasted your API key as an argument, it is now in your shell history: consider rotating it.`,
      )
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
      // Node's wording names the flag and never its value; the first line is enough.
      return new UsageError(
        `${error instanceof Error ? error.message.split('\n')[0] : 'Invalid option'}. Run \`${help}\`.`,
      )
    default:
      return error instanceof Error ? error : new Error('Flag parsing failed')
  }
}

/** @throws UsageError for anything but the flags `options` defines. */
export function parseFlags<O extends OptionsConfig>(
  args: readonly string[],
  options: O,
  command: string,
): FlagValues<O> {
  if (args.filter(isFlag).some((arg) => KEY_FLAGS.has(nameOf(arg).toLowerCase()))) {
    throw new UsageError(KEY_FLAG_MESSAGE)
  }
  try {
    const { values } = parseArgs({
      args: [...args],
      options,
      strict: true,
      allowPositionals: false,
    })
    // parseArgs types its result conditionally on `O`, which a generic cannot
    // resolve; strict mode and options without `multiple` give exactly this shape.
    return Object.freeze(values) as unknown as FlagValues<O>
  } catch (error: unknown) {
    throw usageErrorOf(error, args, options, command)
  }
}
