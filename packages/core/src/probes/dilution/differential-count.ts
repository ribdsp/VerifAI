/**
 * Group F: the input count one fixed string adds, read again and again.
 *
 * Each draw sends a short prompt, then the same prompt with a test string
 * appended, both as the smallest generation the endpoint accepts, and subtracts the input count
 * reported for the first from the second. The template and anything a server
 * adds are in both requests and cancel, so what is left is how the answering
 * model's tokenizer splits the test string. That is the same on every platform
 * and through every translation layer that serves one model, and it generally
 * differs between models - so a run whose draws disagree reached more than one.
 *
 * The draws are judged against the run's own majority, not against a count
 * known in advance: no Claude tokenizer is public, and what an OpenAI model
 * counts is Group C's question. Which model the majority is comes from the
 * other groups. Generations are read rather than `count_tokens`, because a
 * count can be answered without the model that generates. Each draw numbers
 * its prompt, so a layer that caches whole responses cannot answer every draw
 * from the first; the number sits before the fixed end of the prompt and does
 * not change what the test string adds.
 */

import { ProbeLost, ProbeNotApplicable } from '../../runner/errors.js'
import { ANTHROPIC_USAGE_TOTAL_INPUT } from '../../sources/anthropic.js'
import { DILUTION_METHOD, UNIFORM_BOUND } from '../../sources/measured.js'
import { MEASURED_DIFFERENTIAL_COUNT } from '../../sources/measured-accounting.js'
import { OPENAI_CHAT_PROMPT_TOKENS } from '../../sources/openai.js'
import { OPENAI_RESPONSES_INPUT_TOKENS } from '../../sources/openai-accounting.js'
import { reportedInput } from '../accounting/shared.js'
import { MAX_OUTPUT_FLOOR, sendAtOutputFloor } from '../output-floor.js'
import { estimateTokens, generationOf, isSuccess } from '../shared.js'
import { BATTERY } from '../tokenizer/shared.js'
import type { DilutionPlan, DilutionProbe, ProbeContext, Signal } from '../types.js'

/** Each draw's two requests. */
const REQUESTS_PER_DRAW = 2

const SEPARATOR = '\n\n'

/** The battery string at `index`, counted round the battery. */
function batteryText(index: number): string {
  const item = BATTERY[index % BATTERY.length]
  if (item === undefined) {
    throw new TypeError('The tokenizer battery is empty')
  }
  return item.text
}

/** Two neighbouring battery strings from `start`. */
function pairAt(start: number): string {
  return [start, start + 1].map(batteryText).join(' ')
}

/** The test string of a run: a pair the nonce chooses, so it is not the same every run. */
export function testString(nonce: string): string {
  let index = 0
  for (const char of nonce) {
    index = (index * 31 + (char.codePointAt(0) ?? 0)) % BATTERY.length
  }
  return pairAt(index)
}

export function basePrompt(nonce: string, draw: number): string {
  return `Draw ${draw}, reference ${nonce}. Reply with one word.`
}

export function testPrompt(nonce: string, draw: number): string {
  return `${basePrompt(nonce, draw)}${SEPARATOR}${testString(nonce)}`
}

/**
 * One draw at its dearest: the longest nonce the runner accepts, a draw number
 * no run reaches, the longest pair and the highest output floor. The planner
 * budgets the preparation as one more draw, which covers its one base prompt
 * sent twice when it finds the floor.
 */
const DRAW_TOKENS = (() => {
  const base = basePrompt('x'.repeat(64), 9999)
  const limit = MAX_OUTPUT_FLOOR
  const tested = BATTERY.map((_item, start) =>
    estimateTokens(`${base}${SEPARATOR}${pairAt(start)}`),
  )
  return estimateTokens(base) + limit + Math.max(...tested) + limit
})()

/** A count, or why there is none: no successful generation, or one that reports no input count. */
type Count = number | 'lost' | 'uncounted'

async function inputCount(context: ProbeContext, prompt: string): Promise<Count> {
  const { protocol } = context.target
  const { exchange } = await sendAtOutputFloor(context, prompt)
  const generation = isSuccess(exchange) ? generationOf(exchange, protocol) : undefined
  if (generation === undefined) {
    return 'lost'
  }
  return reportedInput(protocol, generation.usage) ?? 'uncounted'
}

/** One draw: the tokens the test string added, or `undefined` when either count is missing. */
async function reading(context: ProbeContext, draw: number): Promise<string | undefined> {
  const base = await inputCount(context, basePrompt(context.nonce, draw))
  if (typeof base !== 'number') {
    return undefined
  }
  const tested = await inputCount(context, testPrompt(context.nonce, draw))
  return typeof tested === 'number' ? String(tested - base) : undefined
}

const NO_SIGNALS: readonly Signal[] = Object.freeze([])

async function prepare(context: ProbeContext): Promise<DilutionPlan> {
  const count = await inputCount(context, basePrompt(context.nonce, 0))
  if (count === 'lost') {
    throw new ProbeLost('The endpoint answered no generation to repeat.')
  }
  if (count === 'uncounted') {
    throw new ProbeNotApplicable('The endpoint reports no input count to repeat.')
  }
  // Numbered on from the prepared request, replacements included, so no two draws match.
  let draws = 0
  return Object.freeze<DilutionPlan>({
    basis: 'mode',
    measures: 'the input tokens a fixed test string adds to a prompt',
    read: (drawContext) => {
      draws += 1
      return reading(drawContext, draws)
    },
    // Uniform or not, which model the draws reached is read from the other groups.
    conclude: () => NO_SIGNALS,
  })
}

export const differentialCount: DilutionProbe = Object.freeze<DilutionProbe>({
  id: 'dilution/differential-count',
  title: 'Routing dilution: the same token count, again and again',
  group: 'F',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic', 'openai'],
  needsKey: true,
  requestsPerDraw: REQUESTS_PER_DRAW,
  cost: { requests: REQUESTS_PER_DRAW, tokens: DRAW_TOKENS },
  citations: [
    DILUTION_METHOD,
    UNIFORM_BOUND,
    MEASURED_DIFFERENTIAL_COUNT,
    ANTHROPIC_USAGE_TOTAL_INPUT,
    OPENAI_CHAT_PROMPT_TOKENS,
    OPENAI_RESPONSES_INPUT_TOKENS,
  ] as const,
  prepare,
})
