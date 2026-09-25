/**
 * Whether a response schema is enforced while the text is generated. Both
 * vendors document structured outputs as constrained decoding: with a schema
 * set, the model's output conforms to it whatever the prompt asks for. This
 * probe asks for a sentence and sets a schema that only a JSON object with
 * one of two nonce-bearing words and an integer satisfies, so prose means the
 * schema never reached a decoder that enforces it.
 *
 * A refusal or a response cut off by its limit is one of the documented
 * exceptions and is not judged. Anthropic may change the capitalization of an
 * `enum` value, so the words are compared without case.
 */

import { anthropicModel } from '@verifai/fingerprints'
import {
  ANTHROPIC_STRUCTURED_CAPITALIZATION,
  ANTHROPIC_STRUCTURED_CONSTRAINED,
  ANTHROPIC_STRUCTURED_EXCEPTIONS,
  ANTHROPIC_STRUCTURED_JSON_OUTPUTS,
} from '../../sources/anthropic-causal.js'
import type { Citation } from '../../sources/citation.js'
import {
  OPENAI_STRUCTURED_ADDITIONAL_PROPERTIES,
  OPENAI_STRUCTURED_ADHERES,
  OPENAI_STRUCTURED_EXCEPTIONS,
  OPENAI_STRUCTURED_MODELS,
  OPENAI_STRUCTURED_STRICT,
} from '../../sources/openai-causal.js'
import type { Protocol } from '../../types/target.js'
import { estimateTokens, generationOf, generationRequest, isSuccess } from '../shared.js'
import type { Calibration, Probe, ProbeContext, ProbeTarget, Signal } from '../types.js'
import { causalSignal, isTextChatModel, LONGEST_NONCE } from './shared.js'

const ID = 'causal/structured-output'

const PROMPT = 'Write one short sentence about the sea.'
const SCHEMA_NAME = 'sea_note'

/** Room for a reasoning model to think before it writes. */
const MAX_TOKENS = 2048
/** What each vendor adds to the prompt to describe the schema. */
const SCHEMA_PROMPT_MARGIN = 512

const FINISHED: ReadonlySet<string> = new Set(['end_turn', 'stop', 'completed'])

/**
 * OpenAI models documented to take a JSON schema: `gpt-4o-2024-08-06`,
 * `gpt-4o-mini` and later, which are the GPT-4o snapshots after the first,
 * GPT-4.1 and newer, and the reasoning models from `o1` on except `o1-mini`
 * and `o1-preview`.
 */
const OPENAI_STRUCTURED =
  /^(?:gpt-4o(?!-2024-05-13)|gpt-4\.1|gpt-5|gpt-6|o1(?!-mini|-preview)|o3|o4-mini)/

function words(nonce: string): readonly [string, string] {
  return [`tide-${nonce}`, `reef-${nonce}`]
}

function schemaFor(nonce: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    type: 'object',
    properties: {
      word: { type: 'string', enum: [...words(nonce)] },
      count: { type: 'integer' },
    },
    required: ['word', 'count'],
    additionalProperties: false,
  })
}

// biome-ignore-start lint/style/useNamingConvention: the vendors' wire names.
function schemaField(
  protocol: Protocol,
  schema: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  switch (protocol) {
    case 'anthropic-messages':
      return { output_config: { format: { type: 'json_schema', schema } } }
    case 'openai-chat':
      return {
        response_format: {
          type: 'json_schema',
          json_schema: { name: SCHEMA_NAME, strict: true, schema },
        },
      }
    case 'openai-responses':
      return { text: { format: { type: 'json_schema', name: SCHEMA_NAME, strict: true, schema } } }
  }
}
// biome-ignore-end lint/style/useNamingConvention: the vendors' wire names.

const TOKENS =
  estimateTokens(PROMPT + JSON.stringify(schemaFor(LONGEST_NONCE))) +
  MAX_TOKENS +
  SCHEMA_PROMPT_MARGIN

interface Terms {
  readonly calibration: Calibration
  readonly citations: readonly [Citation, ...Citation[]]
}

const ANTHROPIC_TERMS: Terms = Object.freeze<Terms>({
  calibration: 'documented',
  citations: [
    ANTHROPIC_STRUCTURED_JSON_OUTPUTS,
    ANTHROPIC_STRUCTURED_CONSTRAINED,
    ANTHROPIC_STRUCTURED_EXCEPTIONS,
    ANTHROPIC_STRUCTURED_CAPITALIZATION,
  ],
})

/** Derived: which models take a schema follows from a snapshot list and "later". */
const OPENAI_TERMS: Terms = Object.freeze<Terms>({
  calibration: 'derived',
  citations: [
    OPENAI_STRUCTURED_ADHERES,
    OPENAI_STRUCTURED_STRICT,
    OPENAI_STRUCTURED_ADDITIONAL_PROPERTIES,
    OPENAI_STRUCTURED_MODELS,
    OPENAI_STRUCTURED_EXCEPTIONS,
  ],
})

/** Whether `text` is exactly an object the schema allows. */
function conforms(text: string, nonce: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(text.trim())
  } catch {
    // Not JSON is the finding, not an error.
    return false
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value).toSorted()
  if (keys.length !== 2 || keys[0] !== 'count' || keys[1] !== 'word') {
    return false
  }
  const { word, count } = value as { readonly word: unknown; readonly count: unknown }
  const allowed = words(nonce).map((entry) => entry.toLowerCase())
  return typeof word === 'string' && allowed.includes(word.toLowerCase()) && Number.isInteger(count)
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { protocol } = context.target
  const terms = protocol === 'anthropic-messages' ? ANTHROPIC_TERMS : OPENAI_TERMS
  const request = generationRequest(context.target, {
    prompt: PROMPT,
    maxTokens: MAX_TOKENS,
    extra: schemaField(protocol, schemaFor(context.nonce)),
  })
  const exchange = await context.send(Object.freeze({ ...request, tokens: TOKENS }))
  const generation = isSuccess(exchange) ? generationOf(exchange, protocol) : undefined
  const text = generation?.text
  const stop = generation?.stopReason
  if (text === undefined || text.trim() === '' || typeof stop !== 'string' || !FINISHED.has(stop)) {
    return []
  }
  const expected = `A JSON object with exactly "word", one of ${words(context.nonce).join(' or ')}, and an integer "count", whatever the prompt asks.`
  const observed = `Asked for a sentence under a JSON schema, the response finished (${stop}) with ${JSON.stringify(text.slice(0, 160))}.`
  if (conforms(text, context.nonce)) {
    return [
      causalSignal(ID, {
        signalId: 'schema-enforced',
        calibration: terms.calibration,
        observed,
        expected,
        llr: { identity: { 'matches-claim': 0.1, 'not-a-live-model': -0.5 } },
        plainLanguage:
          'The request asked for a sentence but set a response format that only a small JSON object with a word unique to this run satisfies, and the response was that object. The format was enforced while the answer was generated, as the vendor documents.',
        citations: terms.citations,
      }),
    ]
  }
  return [
    causalSignal(ID, {
      signalId: 'schema-ignored',
      calibration: terms.calibration,
      observed,
      expected,
      llr: { translation: { translated: 0.7 } },
      plainLanguage:
        "The request set a response format and the response finished normally without following it. The vendor's API enforces the format while the answer is generated, so it was not enforced here: something between you and the model dropped or rewrote it, or what answered does not enforce it.",
      citations: terms.citations,
    }),
  ]
}

function applies(target: ProbeTarget): boolean {
  if (target.pairing !== 'native') {
    return false
  }
  const model = target.claimedModel
  return target.claimedVendor === 'anthropic'
    ? anthropicModel(model) !== undefined
    : OPENAI_STRUCTURED.test(model) && isTextChatModel(model)
}

export const structuredOutput: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Response schema enforced while generating',
  group: 'D',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic', 'openai'],
  applies,
  needsKey: true,
  cost: { requests: 1, tokens: TOKENS },
  citations: [ANTHROPIC_STRUCTURED_CONSTRAINED, OPENAI_STRUCTURED_ADHERES],
  run,
})
