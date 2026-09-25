/**
 * Whether the tokens the endpoint reports are tokens of the claimed model's
 * encoding. With `logprobs` on, OpenAI returns each output token with its
 * UTF-8 bytes and a log probability. OpenAI publishes its encodings, so every
 * reported token can be checked on this machine: a genuine backend reports
 * tokens its encoding has, whose bytes are the token's text and whose text
 * joins back into the answer.
 *
 * The prompt asks for a sentence whose words split differently in the two
 * encodings this build carries. Tokens that are not single tokens of the
 * claimed encoding were cut by another tokenizer. Which encoding a model uses
 * is taken from the model catalogue, which derives it, so that reading is no
 * stronger than the catalogue; the entry's own shape is documented.
 */

import {
  isJsonObject,
  type JsonObject,
  member,
  objectsIn,
  readArray,
  readObject,
} from '../../adapters/json.js'
import {
  OPENAI_LOGPROB_VALUE,
  OPENAI_LOGPROBS,
  OPENAI_LOGPROBS_BYTES,
} from '../../sources/openai-causal.js'
import { type LocalTokenizer, loadTokenizer } from '../../tokenizer/local.js'
import { estimateTokens, generationOf, generationRequest, isSuccess, jsonOf } from '../shared.js'
import type { Exchange, Probe, ProbeContext, Signal } from '../types.js'
import { causalSignal, distinct, encodingsFor, tokenProbeApplies, weakest } from './shared.js'

const ID = 'causal/logprobs-retokenize'

const PROMPT =
  'Repeat this sentence exactly, and write nothing else: The lizard drifted past the lighthouse, grinned at the meadow and the orchard, then blinked sequentially.'
const MAX_TOKENS = 64

/** Tokens judged for membership: a word, with or without its leading space. */
const WORD_TOKEN = /^ ?[A-Za-z]+$/
/** A token that is part of a character, whose text cannot equal its bytes. */
const PARTIAL = /\uFFFD|^bytes:/
/** Fewer foreign tokens than this could be a slip, not another tokenizer. */
const MIN_FOREIGN = 2

interface Entry {
  readonly token: string
  readonly logprob: number
  readonly bytes: readonly number[] | null
}

type Reading =
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed'; readonly problem: string }
  | { readonly kind: 'tokens'; readonly entries: readonly Entry[] }

function sameBytes(bytes: readonly number[], text: string): boolean {
  const expected = new TextEncoder().encode(text)
  return bytes.length === expected.length && bytes.every((byte, at) => byte === expected[at])
}

/** One `logprobs.content` entry, or what is wrong with it. */
function readEntry(value: JsonObject, at: number): Entry | string {
  const token = member(value, 'token')
  const logprob = member(value, 'logprob')
  const bytes = member(value, 'bytes')
  if (typeof token !== 'string') {
    return `entry ${at} has no string token`
  }
  if (typeof logprob !== 'number' || !Number.isFinite(logprob) || logprob > 0) {
    return `entry ${at} has logprob ${logprob === undefined ? 'absent' : JSON.stringify(logprob)}`
  }
  if (bytes === null) {
    return Object.freeze({ token, logprob, bytes: null })
  }
  if (
    !Array.isArray(bytes) ||
    !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return `entry ${at} has bytes that are neither null nor a list of byte values`
  }
  if (!PARTIAL.test(token) && !sameBytes(bytes, token)) {
    return `entry ${at} has bytes that are not the UTF-8 of ${JSON.stringify(token)}`
  }
  return Object.freeze({ token, logprob, bytes: Object.freeze([...bytes]) })
}

function read(exchange: Exchange, text: string): Reading {
  const body = jsonOf(exchange)
  const choice = isJsonObject(body) ? objectsIn(readArray(body, 'choices'))[0] : undefined
  const logprobs = choice === undefined ? undefined : readObject(choice, 'logprobs')
  const content = logprobs === undefined ? undefined : readArray(logprobs, 'content')
  if (content === undefined) {
    return { kind: 'missing' }
  }
  const entries: Entry[] = []
  for (const [at, value] of content.entries()) {
    const entry = isJsonObject(value) ? readEntry(value, at) : `entry ${at} is not an object`
    if (typeof entry === 'string') {
      return { kind: 'malformed', problem: entry }
    }
    entries.push(entry)
  }
  const isClean = entries.every((entry) => !PARTIAL.test(entry.token))
  if (entries.length === 0 || (isClean && entries.map((entry) => entry.token).join('') !== text)) {
    return { kind: 'malformed', problem: 'the tokens do not join into the answer' }
  }
  return { kind: 'tokens', entries: Object.freeze(entries) }
}

function isSingle(tokenizer: LocalTokenizer, token: string): boolean {
  return tokenizer.encode(token).length === 1
}

function quotedList(tokens: readonly string[]): string {
  return tokens.map((token) => JSON.stringify(token)).join(', ')
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const encodings = encodingsFor(context.target.claimedModel)
  const exchange = await context.send(
    generationRequest(context.target, {
      prompt: PROMPT,
      maxTokens: MAX_TOKENS,
      extra: { logprobs: true },
    }),
  )
  const text = isSuccess(exchange) ? generationOf(exchange, 'openai-chat')?.text : undefined
  if (text === undefined || text === '') {
    return []
  }
  const reading = read(exchange, text)
  const expected =
    'Each output token with a log probability of 0 or less and its UTF-8 bytes; the tokens join into the answer.'
  if (reading.kind === 'missing') {
    return [
      causalSignal(ID, {
        signalId: 'logprobs-missing',
        calibration: 'documented',
        observed: 'Asked for log probabilities, the response had text but no logprobs.content.',
        expected,
        llr: { translation: { translated: 0.3 } },
        plainLanguage:
          "The request asked for the probability of each token written, and the response did not include them. OpenAI's API returns them when asked, so something between you and the model dropped the setting or the answer. It says nothing about which model answered.",
        citations: [OPENAI_LOGPROBS],
      }),
    ]
  }
  if (reading.kind === 'malformed') {
    return [
      causalSignal(ID, {
        signalId: 'logprobs-malformed',
        calibration: 'documented',
        observed: `Asked for log probabilities, the response's logprobs.content broke OpenAI's format: ${reading.problem}.`,
        expected,
        llr: { identity: { 'matches-claim': -0.3 }, translation: { translated: 0.5 } },
        plainLanguage:
          "The request asked for the probability of each token written, and the list that came back does not match what OpenAI's API returns. Something other than OpenAI's API wrote it.",
        citations: [OPENAI_LOGPROBS, OPENAI_LOGPROBS_BYTES, OPENAI_LOGPROB_VALUE],
      }),
    ]
  }

  const [claimed, other] = await Promise.all([
    loadTokenizer(encodings.claimed),
    loadTokenizer(encodings.other),
  ])
  const words = reading.entries
    .map((entry) => entry.token)
    .filter((token) => WORD_TOKEN.test(token))
  const foreign = words.filter((token) => !isSingle(claimed, token))
  const calibration = weakest('documented', encodings.fact.calibration)
  const citations = distinct([OPENAI_LOGPROBS, OPENAI_LOGPROBS_BYTES, ...encodings.fact.sources])
  const observed = `${reading.entries.length} tokens reported; ${words.length} are words, of which ${foreign.length} are not single tokens in ${encodings.claimed}${foreign.length === 0 ? '' : ` (${quotedList(foreign.slice(0, 8))})`}.`
  const expectedTokens = `Every reported token is a single token of ${encodings.claimed}, the claimed model's encoding.`

  if (foreign.length >= MIN_FOREIGN) {
    const isOtherEncoding = foreign.every((token) => isSingle(other, token))
    return [
      causalSignal(ID, {
        signalId: 'foreign-tokens',
        calibration,
        observed,
        expected: expectedTokens,
        llr: {
          identity: {
            'matches-claim': -0.7,
            ...(isOtherEncoding ? { 'same-vendor-cheaper': 0.3 } : { 'different-vendor': 0.3 }),
          },
        },
        plainLanguage: `The endpoint reported the pieces its model wrote the answer in, and some of them are not pieces of the claimed model's vocabulary${isOtherEncoding ? ` but are pieces of OpenAI's ${encodings.other} vocabulary` : ''}. The model that cut the answer into these pieces does not use the claimed model's vocabulary.`,
        citations,
      }),
    ]
  }
  const telling = words.filter((token) => !isSingle(other, token))
  if (foreign.length === 0 && telling.length > 0) {
    return [
      causalSignal(ID, {
        signalId: 'claimed-tokens',
        calibration,
        observed: `${observed} ${telling.length} of them are not single tokens in ${encodings.other}.`,
        expected: expectedTokens,
        llr: { identity: { 'matches-claim': 0.2, 'different-vendor': -0.3 } },
        plainLanguage:
          "The endpoint reported the pieces its model wrote the answer in, and every one is a piece of the claimed model's vocabulary, including some that another OpenAI vocabulary does not have.",
        citations,
      }),
    ]
  }
  return []
}

export const logprobsRetokenize: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Reported tokens belong to the claimed encoding',
  group: 'D',
  protocols: ['openai-chat'],
  vendors: ['openai'],
  applies: tokenProbeApplies,
  needsKey: true,
  cost: { requests: 1, tokens: estimateTokens(PROMPT) + MAX_TOKENS },
  citations: [OPENAI_LOGPROBS, OPENAI_LOGPROBS_BYTES, OPENAI_LOGPROB_VALUE],
  run,
})
