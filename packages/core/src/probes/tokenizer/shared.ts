/**
 * Differential counting, shared by Group C.
 *
 * Each probe sends one short prompt, then the same prompt with each string of
 * a battery appended, and subtracts the input count reported for the first
 * from each of the others. The message template and whatever a server adds
 * are in both requests, so they cancel, and what remains is how the answering
 * backend's tokenizer splits the appended text. The battery is chosen so
 * tokenizers disagree on it: scripts other than Latin, emoji sequences, runs
 * of whitespace, base64 and code.
 *
 * The same deltas are computed here with OpenAI's public encodings, and with
 * the length-based estimates a layer that invents usage tends to use.
 */

import { ProbeLost } from '../../runner/errors.js'
import type { Citation } from '../../sources/citation.js'
import { type LocalEncoding, loadTokenizer } from '../../tokenizer/local.js'
import { reportedInput } from '../accounting/shared.js'
import { discoveryCost, MAX_OUTPUT_FLOOR, sendAtOutputFloor } from '../output-floor.js'
import { estimateTokens, generationOf, isSuccess, signal } from '../shared.js'
import type { ProbeContext, Signal } from '../types.js'

export interface BatteryItem {
  readonly name: string
  readonly text: string
}

export const BATTERY: readonly BatteryItem[] = Object.freeze([
  { name: 'chinese', text: '潮汐是由月球和太阳的引力引起的海平面周期性涨落。' },
  { name: 'emoji', text: '👨‍👩‍👧‍👦 🏳️‍🌈 👩🏽‍💻 🧑‍🚀 🫶🏾' },
  { name: 'cyrillic', text: 'Приливы и отливы вызваны притяжением Луны и Солнца.' },
  { name: 'arabic', text: 'المد والجزر ناتجان عن جاذبية القمر والشمس.' },
  { name: 'whitespace', text: `a${' '.repeat(17)}b\t\t\t\tc\n\n\n\n\nd${' '.repeat(9)}e` },
  { name: 'base64', text: 'U2VsYW1hdCBwYWdpLCBkdW5pYSEgVGlkZXMgYXJlIHJpc2luZy4gMTIzNDU2Nzg5MA==' },
  { name: 'code', text: 'for (let i = 0; i < n; i++) { total += values[i] * weights[i]; }' },
  {
    name: 'indonesian',
    text: 'Pasang surut air laut disebabkan oleh gaya tarik bulan dan matahari terhadap bumi.',
  },
])

const SEPARATOR = '\n\n'

export function basePrompt(nonce: string): string {
  return `Reference ${nonce}. Reply with one word.`
}

export function itemPrompt(nonce: string, item: BatteryItem): string {
  return `${basePrompt(nonce)}${SEPARATOR}${item.text}`
}

const LONGEST_NONCE = 'x'.repeat(64)

const BATTERY_PROMPT_TOKENS = [
  basePrompt(LONGEST_NONCE),
  ...BATTERY.map((item) => itemPrompt(LONGEST_NONCE, item)),
].map(estimateTokens)
const BATTERY_DISCOVERY = discoveryCost(Math.max(...BATTERY_PROMPT_TOKENS))

/**
 * The base prompt and every battery prompt, each billed at the highest output
 * limit, and the one sent first sent twice if it finds that limit.
 */
export const BATTERY_COST = Object.freeze({
  requests: BATTERY_PROMPT_TOKENS.length + BATTERY_DISCOVERY.requests,
  tokens:
    BATTERY_PROMPT_TOKENS.reduce((sum, tokens) => sum + tokens + MAX_OUTPUT_FLOOR, 0) +
    BATTERY_DISCOVERY.tokens,
})

/** Per battery item, in battery order: tokens added by appending it. */
export type Deltas = readonly number[]

/**
 * The input count the endpoint reports for each prompt, as deltas from the
 * base prompt, measured once per run and protocol. `undefined` when a
 * generation reports no input count.
 *
 * @throws ProbeLost when a prompt is not answered with a generation.
 */
export function measuredDeltas(context: ProbeContext): Promise<Deltas | undefined> {
  const { protocol } = context.target
  return context.shared(`tokenizer/${protocol}-deltas`, async () => {
    const prompts = [
      basePrompt(context.nonce),
      ...BATTERY.map((item) => itemPrompt(context.nonce, item)),
    ]
    const counts: (number | undefined)[] = []
    for (const prompt of prompts) {
      counts.push(await inputCount(context, prompt))
    }
    const [base, ...items] = counts
    if (base === undefined || items.some((count) => count === undefined)) {
      return undefined
    }
    return Object.freeze(items.map((count) => (count ?? base) - base))
  })
}

async function inputCount(context: ProbeContext, prompt: string): Promise<number | undefined> {
  const { protocol } = context.target
  const { exchange } = await sendAtOutputFloor(context, prompt)
  const generation = isSuccess(exchange) ? generationOf(exchange, protocol) : undefined
  if (generation === undefined) {
    throw new ProbeLost('The endpoint did not answer a tokenizer prompt with a generation.')
  }
  return reportedInput(protocol, generation.usage)
}

/** The deltas an encoding gives the battery, with the nonce the run used. */
export async function localDeltas(encoding: LocalEncoding, nonce: string): Promise<Deltas> {
  const tokenizer = await loadTokenizer(encoding)
  const base = tokenizer.count(basePrompt(nonce))
  return Object.freeze(BATTERY.map((item) => tokenizer.count(itemPrompt(nonce, item)) - base))
}

export function meanAbsoluteDeviation(measured: Deltas, expected: Deltas): number {
  const total = measured.reduce(
    (sum, delta, index) => sum + Math.abs(delta - (expected[index] ?? 0)),
    0,
  )
  return measured.length === 0 ? 0 : total / measured.length
}

export function isExact(measured: Deltas, expected: Deltas): boolean {
  return (
    measured.length === expected.length &&
    measured.every((delta, index) => delta === expected[index])
  )
}

/** Every delta the same: counts that do not follow the text at all. */
export function isConstant(measured: Deltas): boolean {
  return measured.every((delta) => delta === measured[0])
}

interface Estimator {
  readonly name: string
  readonly length: (text: string) => number
  readonly divisor: number
}

const UTF8 = new TextEncoder()

const ESTIMATORS: readonly Estimator[] = Object.freeze(
  [3, 4].flatMap((divisor) => [
    { name: `characters / ${divisor}`, length: (text: string) => text.length, divisor },
    { name: `code points / ${divisor}`, length: (text: string) => [...text].length, divisor },
    {
      name: `UTF-8 bytes / ${divisor}`,
      length: (text: string) => UTF8.encode(text).length,
      divisor,
    },
  ]),
)

/** The length estimate that accounts for every delta to within rounding, if one does. */
export function matchingEstimator(measured: Deltas): string | undefined {
  const match = ESTIMATORS.find((estimator) =>
    BATTERY.every((item, index) => {
      const delta = measured[index]
      const estimate = estimator.length(`${SEPARATOR}${item.text}`) / estimator.divisor
      return delta !== undefined && Math.abs(delta - estimate) <= 1
    }),
  )
  return match?.name
}

export function describeDeltas(deltas: Deltas): string {
  return BATTERY.map((item, index) => `${item.name} ${deltas[index] ?? 'absent'}`).join(', ')
}

/** A Group C signal: `probeId` and `family` filled in. */
export function tokenizerSignal(probeId: string, spec: Omit<Signal, 'probeId' | 'family'>): Signal {
  return signal({ probeId, family: 'tokenizer', ...spec })
}

/** What every Group C probe concludes when the counts are not made by a tokenizer at all. */
export function rewrittenCounts(
  probeId: string,
  measured: Deltas,
  sources: readonly [Citation, ...Citation[]],
): Signal | undefined {
  if (isConstant(measured)) {
    return tokenizerSignal(probeId, {
      signalId: 'constant-counts',
      calibration: 'derived',
      observed: `Appending each test string added the same number of input tokens: ${describeDeltas(measured)}.`,
      expected:
        'Input counts that grow with the text appended, by different amounts for different texts.',
      llr: { identity: { 'not-a-live-model': 0.2 }, translation: { translated: 0.5 } },
      plainLanguage:
        'Appending texts of different lengths and scripts to the prompt changed the reported input count by the same amount each time. A tokenizer does not count like that, so a layer between you and the model wrote these numbers.',
      citations: sources,
    })
  }
  const estimator = matchingEstimator(measured)
  if (estimator !== undefined) {
    return tokenizerSignal(probeId, {
      signalId: 'estimated-counts',
      calibration: 'derived',
      observed: `Appending each test string added input tokens that follow ${estimator}: ${describeDeltas(measured)}.`,
      expected: "Input counts made by the model's own tokenizer.",
      llr: { translation: { translated: 0.5 } },
      plainLanguage: `The reported input counts follow the length of the text (${estimator}) rather than any tokenizer, so a layer between you and the model estimated them. It says nothing about which model answered.`,
      citations: sources,
    })
  }
  return undefined
}
