/**
 * `verifai check`'s flags, read into the fields of a check request.
 *
 * Only the shape is settled here - a closed choice is one of its members, a
 * number is a whole number, a duration has a unit. What the values mean is
 * left to `parseCheckRequest` and `prepareCheck`, the same code the web UI's
 * requests go through, so the two front ends cannot disagree about what is
 * valid.
 */

import {
  AUTH_CHOICES,
  type AuthChoice,
  MAX_REQUESTS_LIMIT,
  MAX_SPREAD_MS,
  MAX_TOKENS_LIMIT,
  type Member,
  PROFILES,
  PROTOCOL_CHOICES,
  type Profile,
  type ProtocolChoice,
  VENDOR_CHOICES,
  type VendorChoice,
  type Vocabulary,
  vocabulary,
} from '@verifai/core'
import { type FlagValues, type OptionsConfig, parseFlags, UsageError } from '../args.js'

export const OUTPUT_FORMATS = vocabulary(['terminal', 'markdown', 'json'])
export type OutputFormat = Member<typeof OUTPUT_FORMATS>

export const CHECK_OPTIONS = {
  endpoint: { type: 'string' },
  model: { type: 'string' },
  vendor: { type: 'string' },
  protocol: { type: 'string' },
  profile: { type: 'string' },
  auth: { type: 'string' },
  'max-requests': { type: 'string' },
  'max-tokens': { type: 'string' },
  spread: { type: 'string' },
  'allow-private-targets': { type: 'boolean' },
  'show-endpoint': { type: 'boolean' },
  format: { type: 'string' },
  out: { type: 'string', short: 'o' },
  yes: { type: 'boolean', short: 'y' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies OptionsConfig

export interface CheckFlags {
  readonly endpoint: string | undefined
  readonly model: string | undefined
  readonly vendor: VendorChoice | undefined
  readonly protocol: ProtocolChoice | undefined
  readonly profile: Profile | undefined
  readonly auth: AuthChoice | undefined
  readonly maxRequests: number | undefined
  readonly maxTokens: number | undefined
  readonly spreadMs: number | undefined
  readonly allowPrivateTargets: boolean
  readonly showEndpoint: boolean
  readonly format: OutputFormat
  readonly out: string | undefined
  readonly yes: boolean
  readonly help: boolean
}

const DURATION = /^(\d{1,9})(ms|s|m|h)$/

const UNIT_MS: Readonly<Record<string, number>> = Object.freeze({
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
})

function listOf(values: readonly string[]): string {
  return values.length < 2
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} or ${values.at(-1) ?? ''}`
}

function choiceOf<T extends string>(
  flag: string,
  value: string | undefined,
  choices: Vocabulary<T>,
): T | undefined {
  if (value === undefined || choices.has(value)) {
    return value
  }
  throw new UsageError(`--${flag}: expected ${listOf(choices.values)}`)
}

function wholeNumber(flag: string, value: string | undefined, min: number, max: number) {
  if (value === undefined) {
    return undefined
  }
  const number = /^\d{1,10}$/.test(value) ? Number(value) : Number.NaN
  if (!(number >= min && number <= max)) {
    throw new UsageError(`--${flag}: expected a whole number from ${min} to ${max}`)
  }
  return number
}

/** `90s`, `10m`, `1h`; `0` alone needs no unit. */
export function parseDuration(value: string): number | undefined {
  if (value === '0') {
    return 0
  }
  const match = DURATION.exec(value)
  const unit = match?.[2] === undefined ? undefined : UNIT_MS[match[2]]
  return match?.[1] === undefined || unit === undefined ? undefined : Number(match[1]) * unit
}

function spreadOf(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const ms = parseDuration(value)
  if (ms === undefined || ms > MAX_SPREAD_MS) {
    throw new UsageError(
      `--spread: expected a duration such as 90s, 10m or 1h, at most ${MAX_SPREAD_MS / 60_000}m`,
    )
  }
  return ms
}

function fromValues(values: FlagValues<typeof CHECK_OPTIONS>): CheckFlags {
  return Object.freeze({
    endpoint: values.endpoint,
    model: values.model,
    vendor: choiceOf('vendor', values.vendor, VENDOR_CHOICES),
    protocol: choiceOf('protocol', values.protocol, PROTOCOL_CHOICES),
    profile: choiceOf('profile', values.profile, PROFILES),
    auth: choiceOf('auth', values.auth, AUTH_CHOICES),
    maxRequests: wholeNumber('max-requests', values['max-requests'], 1, MAX_REQUESTS_LIMIT),
    maxTokens: wholeNumber('max-tokens', values['max-tokens'], 0, MAX_TOKENS_LIMIT),
    spreadMs: spreadOf(values.spread),
    allowPrivateTargets: values['allow-private-targets'] === true,
    showEndpoint: values['show-endpoint'] === true,
    format: choiceOf('format', values.format, OUTPUT_FORMATS) ?? 'terminal',
    out: values.out,
    yes: values.yes === true,
    help: values.help === true,
  })
}

/** @throws UsageError naming the flag, never its value. */
export function parseCheckFlags(args: readonly string[]): CheckFlags {
  return fromValues(parseFlags(args, CHECK_OPTIONS, 'verifai check'))
}
