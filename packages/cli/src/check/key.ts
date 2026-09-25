/**
 * Where `verifai check` gets the API key: the environment, or a masked prompt.
 *
 * Never a flag - `parseFlags` refuses those - and never a file. The key is
 * handed straight to the check request and held nowhere else here.
 */

import { API_KEY_ENV } from '../args.js'
import type { CliContext } from '../io.js'

export type KeySource =
  | { readonly ok: true; readonly apiKey: string | undefined }
  /** The buyer cancelled the prompt. */
  | { readonly ok: false }

const PROMPT = 'API key (input is hidden; leave empty to run only the probes that need none)'

export async function readApiKey(context: CliContext): Promise<KeySource> {
  const fromEnv = context.env[API_KEY_ENV]?.trim()
  if (fromEnv !== undefined && fromEnv !== '') {
    return { ok: true, apiKey: fromEnv }
  }
  if (!context.interactive) {
    return { ok: true, apiKey: undefined }
  }
  const typed = await context.prompts.password(PROMPT)
  if (typed === undefined) {
    return { ok: false }
  }
  const trimmed = typed.trim()
  return { ok: true, apiKey: trimmed === '' ? undefined : trimmed }
}
