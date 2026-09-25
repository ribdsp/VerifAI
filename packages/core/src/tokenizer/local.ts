/**
 * OpenAI's public encodings, counted here rather than asked of the endpoint.
 *
 * This is the asymmetry Group C is built on: OpenAI publishes its tokenizers,
 * so for a model it names an encoding for, the count a genuine backend reports
 * can be computed exactly on the buyer's machine. Anthropic publishes none, so
 * nothing here speaks for a Claude model - except that an endpoint claiming
 * Claude whose counts match `o200k_base` exactly is counting like OpenAI.
 *
 * Each encoding's table is several megabytes, so each is imported the first
 * time it is needed and never before.
 */

import { type Member, vocabulary } from '../types/vocabulary.js'

export const LOCAL_ENCODINGS = vocabulary(['o200k_base', 'cl100k_base'])
export type LocalEncoding = Member<typeof LOCAL_ENCODINGS>

export interface LocalTokenizer {
  readonly encoding: LocalEncoding
  readonly encode: (text: string) => readonly number[]
  readonly decode: (tokens: readonly number[]) => string
  readonly count: (text: string) => number
}

interface EncodingModule {
  readonly encode: (text: string) => number[]
  readonly decode: (tokens: Iterable<number>) => string
  readonly countTokens: (text: string) => number
}

// biome-ignore-start lint/style/useNamingConvention: tiktoken's encoding names.
const IMPORTS: Readonly<Record<LocalEncoding, () => Promise<EncodingModule>>> = Object.freeze({
  o200k_base: () => import('gpt-tokenizer/encoding/o200k_base'),
  cl100k_base: () => import('gpt-tokenizer/encoding/cl100k_base'),
})
// biome-ignore-end lint/style/useNamingConvention: tiktoken's encoding names.

const loaded = new Map<LocalEncoding, Promise<LocalTokenizer>>()

async function load(encoding: LocalEncoding): Promise<LocalTokenizer> {
  const module = await IMPORTS[encoding]()
  return Object.freeze({
    encoding,
    encode: (text: string) => Object.freeze(module.encode(text)),
    decode: (tokens: readonly number[]) => module.decode(tokens),
    count: (text: string) => module.countTokens(text),
  })
}

/**
 * @throws TypeError for an encoding this build does not carry.
 */
export function loadTokenizer(encoding: LocalEncoding): Promise<LocalTokenizer> {
  if (!LOCAL_ENCODINGS.has(encoding)) {
    throw new TypeError(`Not a local encoding: ${JSON.stringify(encoding)}`)
  }
  const cached = loaded.get(encoding)
  if (cached !== undefined) {
    return cached
  }
  const pending = load(encoding)
  loaded.set(encoding, pending)
  // A failed import is not cached, so a later probe gets its own attempt and its own error.
  pending.catch(() => loaded.delete(encoding))
  return pending
}
