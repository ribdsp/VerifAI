/**
 * Whether a token chosen by its ID comes back as the claimed model's token.
 * OpenAI's `logit_bias` takes token IDs and says a bias of 100 should make
 * the token the only one selected. An ID means a different string in each
 * encoding, so what the endpoint writes under the bias shows which encoding
 * the model behind it samples from - a fact about the backend that no amount
 * of wire-format imitation supplies.
 *
 * The ID is picked from the run's nonce among those that decode to a
 * lowercase word in both encodings this build carries, and to different
 * words, so a proxy cannot keep an answer ready. Which encoding a model uses
 * is taken from the model catalogue, which derives it; the signals are no
 * stronger than that.
 */

import { ProbeNotApplicable } from '../../runner/errors.js'
import { OPENAI_LOGIT_BIAS } from '../../sources/openai.js'
import {
  OPENAI_LOGIT_BIAS_ADDED,
  OPENAI_LOGIT_BIAS_EXCLUSIVE,
} from '../../sources/openai-causal.js'
import { type LocalTokenizer, loadTokenizer } from '../../tokenizer/local.js'
import { estimateTokens, generationOf, generationRequest, isSuccess } from '../shared.js'
import type { Probe, ProbeContext, Signal } from '../types.js'
import {
  causalSignal,
  distinct,
  encodingsFor,
  fnv1a,
  tokenProbeApplies,
  weakest,
} from './shared.js'

const ID = 'causal/logit-bias'

const PROMPT = 'Reply with one short word.'
const MAX_TOKENS = 2
const BIAS = 100

/** Low IDs are bytes and fragments; these are whole words in both encodings. */
const FIRST_ID = 1000
const ID_SPAN = 7000

const WORD = /^ ?[a-z]{4,}$/

interface Choice {
  readonly id: number
  readonly claimed: string
  readonly other: string
}

/** `id` decodes to a word that encodes back to `id` alone. */
function wordOf(tokenizer: LocalTokenizer, id: number): string | undefined {
  const text = tokenizer.decode([id])
  const tokens = tokenizer.encode(text)
  return WORD.test(text) && tokens.length === 1 && tokens[0] === id ? text.trim() : undefined
}

function choose(nonce: string, claimed: LocalTokenizer, other: LocalTokenizer): Choice {
  const start = fnv1a(nonce) % ID_SPAN
  for (let step = 0; step < ID_SPAN; step += 1) {
    const id = FIRST_ID + ((start + step) % ID_SPAN)
    const inClaimed = wordOf(claimed, id)
    const inOther = wordOf(other, id)
    if (
      inClaimed !== undefined &&
      inOther !== undefined &&
      !inClaimed.startsWith(inOther) &&
      !inOther.startsWith(inClaimed)
    ) {
      return Object.freeze({ id, claimed: inClaimed, other: inOther })
    }
  }
  throw new ProbeNotApplicable('No token ID decodes to a different word in each encoding.')
}

/** The word written once or twice, which is what two tokens of it look like without spaces. */
function isRepeated(text: string, word: string): boolean {
  return text === word || text === `${word}${word}`
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const encodings = encodingsFor(context.target.claimedModel)
  const [claimed, other] = await Promise.all([
    loadTokenizer(encodings.claimed),
    loadTokenizer(encodings.other),
  ])
  const choice = choose(context.nonce, claimed, other)
  const exchange = await context.send(
    generationRequest(context.target, {
      prompt: PROMPT,
      maxTokens: MAX_TOKENS,
      // biome-ignore lint/style/useNamingConvention: OpenAI's wire name.
      extra: { logit_bias: { [String(choice.id)]: BIAS } },
    }),
  )
  const text = isSuccess(exchange) ? generationOf(exchange, 'openai-chat')?.text : undefined
  const written = text?.replace(/\s+/g, '') ?? ''
  if (written === '') {
    return []
  }
  const calibration = weakest('documented', encodings.fact.calibration)
  const citations = distinct([
    OPENAI_LOGIT_BIAS,
    OPENAI_LOGIT_BIAS_ADDED,
    OPENAI_LOGIT_BIAS_EXCLUSIVE,
    ...encodings.fact.sources,
  ])
  const observed = `Under a bias of ${BIAS} on token ${choice.id}, the response was ${JSON.stringify(text?.slice(0, 80))}.`
  const expected = `Token ${choice.id} is "${choice.claimed}" in ${encodings.claimed}, the claimed model's encoding, and "${choice.other}" in ${encodings.other}.`

  if (isRepeated(written, choice.claimed)) {
    return [
      causalSignal(ID, {
        signalId: 'claimed-token',
        calibration,
        observed,
        expected,
        llr: { identity: { 'matches-claim': 0.2, 'different-vendor': -0.7 } },
        plainLanguage:
          "One token was forced by its number, and the answer was the word that number stands for in the claimed model's vocabulary. A model with another vocabulary writes a different word for this number.",
        citations,
      }),
    ]
  }
  if (isRepeated(written, choice.other)) {
    return [
      causalSignal(ID, {
        signalId: 'other-encoding-token',
        calibration,
        observed,
        expected,
        llr: { identity: { 'matches-claim': -0.7, 'same-vendor-cheaper': 0.3 } },
        plainLanguage: `One token was forced by its number, and the answer was the word that number stands for in OpenAI's ${encodings.other} vocabulary, not in the claimed model's. The model that answered samples from a different vocabulary than the claimed model does.`,
        citations,
      }),
    ]
  }
  return [
    causalSignal(ID, {
      signalId: 'bias-not-followed',
      calibration,
      observed,
      expected,
      llr: { translation: { translated: 0.4 } },
      plainLanguage:
        "One token was forced by its number, and the answer was neither word that number stands for in OpenAI's vocabularies. Something between you and the model dropped the setting, or what answered does not read token numbers the way OpenAI's models do.",
      citations,
    }),
  ]
}

export const logitBias: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Token forced by ID decodes in the claimed encoding',
  group: 'D',
  protocols: ['openai-chat'],
  vendors: ['openai'],
  applies: tokenProbeApplies,
  needsKey: true,
  cost: { requests: 1, tokens: estimateTokens(PROMPT) + MAX_TOKENS },
  citations: [OPENAI_LOGIT_BIAS, OPENAI_LOGIT_BIAS_ADDED, OPENAI_LOGIT_BIAS_EXCLUSIVE],
  run,
})
