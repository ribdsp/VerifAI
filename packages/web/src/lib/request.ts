/**
 * The check form's values, and the `CheckRequest` they become.
 *
 * The form holds everything as typed text except the API key, which is not
 * part of these values at all: the form component keeps it in its own state
 * and hands it to `buildCheckRequest` for the one moment it takes to build the
 * body. Validation is core's `parseCheckRequest`, the same schema the daemon
 * applies, so the page and the daemon cannot disagree about what is valid.
 */

import {
  type AuthChoice,
  type CheckRequest,
  MAX_SPREAD_MS,
  type OptionsResponse,
  type Profile,
  type ProtocolChoice,
  parseCheckRequest,
  type VendorChoice,
} from '@verifai/core'

export interface CheckFormValues {
  readonly endpoint: string
  readonly model: string
  readonly vendor: VendorChoice
  readonly protocol: ProtocolChoice
  readonly profile: Profile
  readonly auth: AuthChoice
  /** Blank means the profile's own budget. */
  readonly maxRequests: string
  readonly maxTokens: string
  /** Minutes, blank for the profile's own spread. */
  readonly spreadMinutes: string
  readonly allowPrivateTargets: boolean
  readonly showEndpoint: boolean
}

export const FORM_FIELDS = Object.freeze([
  'endpoint',
  'apiKey',
  'model',
  'vendor',
  'protocol',
  'profile',
  'auth',
  'maxRequests',
  'maxTokens',
  'spreadMs',
  'allowPrivateTargets',
  'showEndpoint',
] as const)
export type FormField = (typeof FORM_FIELDS)[number]

const MS_PER_MINUTE = 60_000
const WHOLE_NUMBER = /^\d+$/
const DECIMAL = /^\d+(\.\d+)?$/

export function initialFormValues(options: OptionsResponse): CheckFormValues {
  return {
    endpoint: '',
    model: '',
    vendor: options.defaults.vendor,
    protocol: options.defaults.protocol,
    profile: options.defaults.profile,
    auth: options.defaults.auth,
    maxRequests: '',
    maxTokens: '',
    spreadMinutes: '',
    allowPrivateTargets: false,
    showEndpoint: false,
  }
}

type Parsed = { readonly value: number | undefined } | { readonly problem: string }

function wholeNumber(text: string, field: FormField): Parsed {
  const trimmed = text.trim()
  if (trimmed === '') {
    return { value: undefined }
  }
  return WHOLE_NUMBER.test(trimmed)
    ? { value: Number(trimmed) }
    : { problem: `${field}: expected a whole number` }
}

function minutes(text: string): Parsed {
  const trimmed = text.trim()
  if (trimmed === '') {
    return { value: undefined }
  }
  if (!DECIMAL.test(trimmed)) {
    return { problem: 'spreadMs: expected a number of minutes' }
  }
  const value = Math.round(Number(trimmed) * MS_PER_MINUTE)
  return value <= MAX_SPREAD_MS
    ? { value }
    : { problem: `spreadMs: expected at most ${MAX_SPREAD_MS / MS_PER_MINUTE} minutes` }
}

export type BuildResult =
  | { readonly ok: true; readonly request: CheckRequest }
  | { readonly ok: false; readonly problems: readonly string[] }

/** The request body, or problems each prefixed with the field they concern. */
export function buildCheckRequest(values: CheckFormValues, apiKey: string): BuildResult {
  const numbers = {
    maxRequests: wholeNumber(values.maxRequests, 'maxRequests'),
    maxTokens: wholeNumber(values.maxTokens, 'maxTokens'),
    spreadMs: minutes(values.spreadMinutes),
  }
  const problems = Object.values(numbers).flatMap((parsed) =>
    'problem' in parsed ? [parsed.problem] : [],
  )
  const key = apiKey.trim()
  const body: Record<string, unknown> = {
    endpoint: values.endpoint.trim(),
    model: values.model.trim(),
    vendor: values.vendor,
    protocol: values.protocol,
    profile: values.profile,
    ...(key === '' ? {} : { apiKey: key }),
    ...(values.auth === 'auto' ? {} : { auth: values.auth }),
    ...Object.fromEntries(
      Object.entries(numbers).flatMap(([field, parsed]) =>
        'value' in parsed && parsed.value !== undefined ? [[field, parsed.value]] : [],
      ),
    ),
    ...(values.allowPrivateTargets ? { allowPrivateTargets: true } : {}),
    ...(values.showEndpoint ? { showEndpoint: true } : {}),
  }
  const parsed = parseCheckRequest(body)
  if (!parsed.ok) {
    return { ok: false, problems: [...new Set([...problems, ...parsed.problems])] }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, request: parsed.value }
}

/** Problems keyed by the field they name; anything else under `form`. */
export function problemsByField(
  problems: readonly string[],
): Readonly<Partial<Record<FormField | 'form', readonly string[]>>> {
  const grouped: Partial<Record<FormField | 'form', string[]>> = {}
  for (const problem of problems) {
    const separator = problem.indexOf(':')
    const named = separator > 0 ? problem.slice(0, separator) : ''
    const field = (FORM_FIELDS as readonly string[]).includes(named) ? (named as FormField) : 'form'
    const text = field === 'form' ? problem : problem.slice(separator + 1).trim()
    grouped[field] = [...(grouped[field] ?? []), text]
  }
  return grouped
}
