/**
 * Whether the endpoint checks the signature on a thinking block handed back to
 * it. Anthropic signs every thinking block it returns, keeps earlier thinking
 * in context on the models this probe speaks to, and refuses a block whose
 * signature was altered. Only the party that signed the block can tell an
 * altered signature from the original, so a layer imitating the wire format
 * cannot pass this by copying what the response looks like.
 *
 * The first turn is replayed twice after it: once exactly as it came, which a
 * genuine backend accepts and counts as input, and once with one character of
 * the signature changed, which it refuses. The altered replay is judged only
 * when the unaltered one was counted, so a layer that drops thinking blocks
 * reads as a layer, never as a different model.
 */

import { type JsonObject, readString } from '../../adapters/json.js'
import {
  ANTHROPIC_THINKING_CANNOT_BE_MODIFIED,
  ANTHROPIC_THINKING_KEPT,
  ANTHROPIC_THINKING_MODIFIED_400,
  ANTHROPIC_THINKING_PREFIX_BOUND,
  ANTHROPIC_THINKING_SIGNATURE,
  ANTHROPIC_THINKING_SIGNATURES_VERIFIED,
  ANTHROPIC_THINKING_UNREADABLE_DROPPED,
} from '../../sources/anthropic-causal.js'
import { errorOf, estimateTokens, generationOf, generationRequest, isSuccess } from '../shared.js'
import type { Exchange, Probe, ProbeContext, ProbeRequest, ProbeTarget, Signal } from '../types.js'
import {
  byteLength,
  causalSignal,
  claimedAnthropic,
  keepsThinking,
  LONGEST_NONCE,
  promptTokens,
  SEED_MAX_TOKENS,
  SEED_TOKENS,
  type ThinkingSeed,
  thinkingConfig,
  thinkingPrompt,
  thinkingSeed,
} from './shared.js'

const ID = 'causal/thinking-signature'

const FOLLOWUP = 'Reply with the single word: done.'

/**
 * Thinking below this is too little to tell counted from dropped against the
 * margin the replayed text and follow-up are allowed.
 */
const MIN_THINKING_TOKENS = 256

/** How much of the first turn's thinking a replay must add to count as kept. */
const KEPT_FRACTION = 0.5

const THINKING_ERROR = /thinking|signature/i

/** A replay repeats the first turn, whose output is bounded by its own limit. */
const REPLAY_TOKENS =
  estimateTokens(thinkingPrompt(LONGEST_NONCE)) +
  estimateTokens(FOLLOWUP) +
  SEED_MAX_TOKENS +
  SEED_MAX_TOKENS

interface SeedReading {
  readonly input: number
  readonly thinking: number
  /** An upper bound on what the replayed text and the follow-up add as input. */
  readonly allowance: number
  /** Index of the first signed thinking block in the first turn's content. */
  readonly signed: number
}

type Replayed = 'kept' | 'dropped'

function isSigned(block: JsonObject): boolean {
  if (readString(block, 'type') !== 'thinking') {
    return false
  }
  const signature = readString(block, 'signature')
  return signature !== undefined && signature !== ''
}

function readSeed(seed: ThinkingSeed): SeedReading | undefined {
  const signed = seed.content.findIndex(isSigned)
  const input = promptTokens(seed.generation)
  const usage = seed.generation?.usage
  const textBytes = byteLength(seed.generation?.text)
  // Output counts thinking and text; text spends at most one token per byte.
  const thinking = usage?.reasoning ?? Math.max(0, (usage?.output ?? 0) - textBytes)
  if (signed < 0 || input === undefined || thinking < MIN_THINKING_TOKENS) {
    return undefined
  }
  return Object.freeze({
    input,
    thinking,
    allowance: textBytes + estimateTokens(FOLLOWUP),
    signed,
  })
}

/** One character of `signature` changed, still in the base64 alphabet. */
function altered(signature: string): string {
  const middle = Math.floor(signature.length / 2)
  const replacement = signature[middle] === 'A' ? 'B' : 'A'
  return `${signature.slice(0, middle)}${replacement}${signature.slice(middle + 1)}`
}

function tamperedContent(seed: ThinkingSeed, index: number): readonly JsonObject[] {
  return seed.content.map((block, at) =>
    at === index ? { ...block, signature: altered(readString(block, 'signature') ?? '') } : block,
  )
}

function replay(
  target: ProbeTarget,
  seed: ThinkingSeed,
  content: readonly JsonObject[],
  provokes: readonly number[],
): ProbeRequest {
  const request = generationRequest(target, {
    prompt: seed.prompt,
    maxTokens: SEED_MAX_TOKENS,
    extra: {
      thinking: seed.thinking,
      messages: [
        { role: 'user', content: seed.prompt },
        { role: 'assistant', content },
        { role: 'user', content: FOLLOWUP },
      ],
    },
  })
  return Object.freeze({
    ...request,
    tokens: REPLAY_TOKENS,
    ...(provokes.length === 0 ? {} : { provokes }),
  })
}

function replayedTokens(exchange: Exchange): number | undefined {
  return isSuccess(exchange)
    ? promptTokens(generationOf(exchange, 'anthropic-messages'))
    : undefined
}

function classify(exchange: Exchange, seed: SeedReading): Replayed | undefined {
  const total = replayedTokens(exchange)
  if (total === undefined) {
    return undefined
  }
  const growth = total - seed.input
  if (growth - seed.allowance >= KEPT_FRACTION * seed.thinking) {
    return 'kept'
  }
  return growth <= seed.allowance ? 'dropped' : undefined
}

function describe(label: string, exchange: Exchange): string {
  const tokens = replayedTokens(exchange)
  return `${label}: HTTP ${exchange.status}${tokens === undefined ? '' : `, ${tokens} prompt tokens`}`
}

function firstTurn(seed: SeedReading): string {
  return `The first turn had ${seed.input} prompt tokens and about ${seed.thinking} thinking tokens.`
}

const EXPECTED_KEPT = `Replayed unchanged, the block is accepted and its thinking counted as input: at least ${KEPT_FRACTION} of the first turn's thinking tokens beyond the replayed text and follow-up.`

function judgeControl(control: Exchange, seed: SeedReading): readonly Signal[] {
  const observed = `${describe('Replayed unchanged', control)}. ${firstTurn(seed)}`
  const message = errorOf(control)?.message
  if (control.status === 400 && message !== undefined && THINKING_ERROR.test(message)) {
    return [
      causalSignal(ID, {
        signalId: 'replay-rejected',
        calibration: 'documented',
        observed,
        expected: EXPECTED_KEPT,
        llr: { translation: { translated: 0.5 } },
        plainLanguage:
          "A thinking block from the endpoint's own response was sent back unchanged and refused with an error about thinking. Anthropic's API accepts its own blocks while they and the conversation before them are unchanged, so something between you and the model changed one of them. It says nothing about which model answered.",
        citations: [
          ANTHROPIC_THINKING_MODIFIED_400,
          ANTHROPIC_THINKING_CANNOT_BE_MODIFIED,
          ANTHROPIC_THINKING_PREFIX_BOUND,
        ],
      }),
    ]
  }
  if (classify(control, seed) === 'dropped') {
    return [
      causalSignal(ID, {
        signalId: 'thinking-dropped',
        calibration: 'documented',
        observed,
        expected: EXPECTED_KEPT,
        llr: { translation: { translated: 0.5 } },
        plainLanguage:
          "A thinking block from the endpoint's own response was sent back unchanged and was not counted as input. For the claimed model, Anthropic's API keeps earlier thinking and counts it, so something between you and the model removed the block. It says nothing about which model answered.",
        citations: [ANTHROPIC_THINKING_KEPT, ANTHROPIC_THINKING_PREFIX_BOUND],
      }),
    ]
  }
  return []
}

function judgeTampered(
  control: Exchange,
  tampered: Exchange,
  seed: SeedReading,
): readonly Signal[] {
  const observed = `${describe('Replayed unchanged', control)}. ${describe('Replayed with one signature character changed', tampered)}. ${firstTurn(seed)}`
  const expected =
    'The unchanged block is accepted and counted; the altered one is refused with HTTP 400.'
  if (tampered.status === 400) {
    return [
      causalSignal(ID, {
        signalId: 'tamper-rejected',
        calibration: 'documented',
        observed,
        expected,
        llr: { identity: { 'different-vendor': -0.5, 'not-a-live-model': -0.5 } },
        plainLanguage:
          "A thinking block from the endpoint's own response was accepted when sent back unchanged and refused once one character of its signature was changed. Anthropic's API verifies each signature this way.",
        citations: [ANTHROPIC_THINKING_SIGNATURES_VERIFIED, ANTHROPIC_THINKING_MODIFIED_400],
      }),
    ]
  }
  const replayed = classify(tampered, seed)
  if (replayed === 'kept') {
    return [
      causalSignal(ID, {
        signalId: 'tamper-accepted',
        calibration: 'documented',
        observed,
        expected,
        llr: {
          identity: {
            'matches-claim': -1,
            'same-vendor-cheaper': -0.5,
            'different-vendor': 0.5,
            'not-a-live-model': 0.2,
          },
        },
        plainLanguage:
          "A thinking block from the endpoint's own response was accepted, and its thinking counted as input, after one character of its signature was changed. Anthropic's API verifies each signature and refuses an altered block, so what read this block does not check signatures the way Anthropic's API does.",
        citations: [
          ANTHROPIC_THINKING_SIGNATURE,
          ANTHROPIC_THINKING_SIGNATURES_VERIFIED,
          ANTHROPIC_THINKING_MODIFIED_400,
          ANTHROPIC_THINKING_CANNOT_BE_MODIFIED,
          ANTHROPIC_THINKING_KEPT,
        ],
        vetoes: ['matches-claim', 'same-vendor-cheaper'],
      }),
    ]
  }
  if (replayed === 'dropped') {
    return [
      causalSignal(ID, {
        signalId: 'tamper-dropped',
        calibration: 'documented',
        observed,
        expected,
        llr: {},
        plainLanguage:
          "A thinking block with one character of its signature changed was accepted without its thinking being counted. Anthropic's API drops a block it cannot read rather than refusing it, so this says nothing either way.",
        citations: [ANTHROPIC_THINKING_UNREADABLE_DROPPED],
      }),
    ]
  }
  return []
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const seed = await thinkingSeed(context)
  const reading = isSuccess(seed.exchange) ? readSeed(seed) : undefined
  if (reading === undefined) {
    return []
  }
  const control = await context.send(replay(context.target, seed, seed.content, []))
  if (!isSuccess(control) || classify(control, reading) !== 'kept') {
    return judgeControl(control, reading)
  }
  const tampered = await context.send(
    replay(context.target, seed, tamperedContent(seed, reading.signed), [400]),
  )
  return judgeTampered(control, tampered, reading)
}

function applies(target: ProbeTarget): boolean {
  const model = claimedAnthropic(target)
  return model !== undefined && keepsThinking(model) && thinkingConfig(model) !== undefined
}

export const thinkingSignature: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'Thinking signatures verified on replay',
  group: 'D',
  protocols: ['anthropic-messages'],
  vendors: ['anthropic'],
  applies,
  needsKey: true,
  cost: { requests: 3, tokens: SEED_TOKENS + 2 * REPLAY_TOKENS },
  citations: [
    ANTHROPIC_THINKING_SIGNATURE,
    ANTHROPIC_THINKING_SIGNATURES_VERIFIED,
    ANTHROPIC_THINKING_MODIFIED_400,
    ANTHROPIC_THINKING_KEPT,
  ],
  run,
})
