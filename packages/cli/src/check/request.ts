/**
 * From flags, prompts and the environment to one validated `CheckRequest`.
 *
 * On a terminal, whatever the flags leave out is asked for; without one, the
 * flags must be complete. Either way the result goes through
 * `parseCheckRequest`, the validation the web UI's requests go through.
 */

import {
  type CheckRequest,
  DEFAULT_PROFILE,
  normaliseModelId,
  PROFILES,
  PROTOCOL_CHOICES,
  type Profile,
  type ProtocolChoice,
  parseCheckRequest,
  parseEndpoint,
  profileDefinition,
  VENDOR_CHOICES,
  type VendorChoice,
} from '@verifai/core'
import { UsageError } from '../args.js'
import type { Choice, CliContext } from '../io.js'
import type { CheckFlags } from './flags.js'
import { readApiKey } from './key.js'

export type Completion =
  | { readonly ok: true; readonly request: CheckRequest }
  /** The buyer cancelled a prompt. */
  | { readonly ok: false }

const ENDPOINT_HINT =
  'expected an http or https base URL with no query string or credentials, such as https://gateway.example/v1'

const MODEL_HINT = 'expected the model name you were sold, such as claude-opus-5-5 or gpt-5'

const VENDOR_LABELS: Readonly<Record<VendorChoice, string>> = Object.freeze({
  auto: 'Read it from the model name',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
})

const PROTOCOL_LABELS: Readonly<Record<ProtocolChoice, string>> = Object.freeze({
  auto: 'Detect it (three requests the vendors reject before inference)',
  'anthropic-messages': 'Anthropic Messages - /v1/messages',
  'openai-chat': 'OpenAI Chat Completions - /v1/chat/completions',
  'openai-responses': 'OpenAI Responses - /v1/responses',
})

const choicesOf = <T extends string>(
  values: readonly T[],
  label: (value: T) => string,
  hint?: (value: T) => string,
): readonly Choice<T>[] =>
  values.map((value) => ({ value, label: label(value), ...(hint ? { hint: hint(value) } : {}) }))

interface Fields {
  readonly endpoint: string
  readonly model: string
  readonly vendor: VendorChoice
  readonly protocol: ProtocolChoice
  readonly profile: Profile
}

/** Asks for each field the flags left out, in the order a buyer thinks of them. */
async function askFields(flags: CheckFlags, context: CliContext): Promise<Fields | undefined> {
  const { prompts } = context
  const endpoint =
    flags.endpoint ??
    (await prompts.text('Endpoint base URL', {
      placeholder: 'https://gateway.example/v1',
      validate: (value) => (parseEndpoint(value).ok ? undefined : ENDPOINT_HINT),
    }))
  if (endpoint === undefined) {
    return undefined
  }
  const model =
    flags.model ??
    (await prompts.text('Model you were sold', {
      placeholder: 'claude-opus-5-5',
      validate: (value) => (normaliseModelId(value).ok ? undefined : MODEL_HINT),
    }))
  if (model === undefined) {
    return undefined
  }
  const vendor =
    flags.vendor ??
    (await prompts.select(
      'Vendor',
      choicesOf(VENDOR_CHOICES.values, (v) => VENDOR_LABELS[v]),
    ))
  if (vendor === undefined) {
    return undefined
  }
  const protocol =
    flags.protocol ??
    (await prompts.select(
      'Protocol',
      choicesOf(PROTOCOL_CHOICES.values, (p) => PROTOCOL_LABELS[p]),
    ))
  if (protocol === undefined) {
    return undefined
  }
  const profile =
    flags.profile ??
    (await prompts.select(
      'Profile',
      choicesOf(
        PROFILES.values,
        (p) => p,
        (p) => profileDefinition(p).description,
      ),
      DEFAULT_PROFILE,
    ))
  return profile === undefined ? undefined : { endpoint, model, vendor, protocol, profile }
}

function fieldsFromFlags(flags: CheckFlags): Fields {
  if (flags.endpoint === undefined || flags.model === undefined) {
    throw new UsageError(
      'Without a terminal to ask in, `verifai check` needs --endpoint and --model. Run `verifai check --help`.',
    )
  }
  return {
    endpoint: flags.endpoint,
    model: flags.model,
    vendor: flags.vendor ?? 'auto',
    protocol: flags.protocol ?? 'auto',
    profile: flags.profile ?? DEFAULT_PROFILE,
  }
}

function isGuided(flags: CheckFlags, context: CliContext): boolean {
  return context.interactive && (flags.endpoint === undefined || flags.model === undefined)
}

/** @throws UsageError for a request that cannot be sent as given. */
export async function completeRequest(flags: CheckFlags, context: CliContext): Promise<Completion> {
  const fields = isGuided(flags, context) ? await askFields(flags, context) : fieldsFromFlags(flags)
  if (fields === undefined) {
    return { ok: false }
  }
  const key = await readApiKey(context)
  if (!key.ok) {
    return { ok: false }
  }
  const parsed = parseCheckRequest({
    ...fields,
    ...(key.apiKey === undefined ? {} : { apiKey: key.apiKey }),
    ...(flags.auth === undefined ? {} : { auth: flags.auth }),
    ...(flags.maxRequests === undefined ? {} : { maxRequests: flags.maxRequests }),
    ...(flags.maxTokens === undefined ? {} : { maxTokens: flags.maxTokens }),
    ...(flags.spreadMs === undefined ? {} : { spreadMs: flags.spreadMs }),
    ...(flags.allowPrivateTargets ? { allowPrivateTargets: true } : {}),
    ...(flags.showEndpoint ? { showEndpoint: true } : {}),
  })
  if (!parsed.ok) {
    throw new UsageError(parsed.problems.join('; '))
  }
  return { ok: true, request: parsed.value }
}
