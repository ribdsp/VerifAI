/**
 * Whether an endpoint sold as a Claude model counts input the way one of
 * OpenAI's public encodings does. Anthropic publishes no tokenizer, so
 * nothing here can show that counts are Claude's. But eight strings chosen
 * because tokenizers split them differently are unlikely to come out the
 * same, token for token, under two different tokenizers, so counts that
 * match `o200k_base` or `cl100k_base` exactly were made by that encoding.
 *
 * That is an OpenAI model answering, or a layer that recounts usage with a
 * public encoding in front of whatever answered. The first moves identity,
 * the second translation, and a buyer cannot tell them apart from counts
 * alone, so the ratio is split between the two - with more weight on
 * translation when the protocol is not Anthropic's own, where a layer that
 * recounts is the ordinary case.
 */

import { ANTHROPIC_NEW_TOKENIZER } from '../../sources/anthropic.js'
import {
  MEASURED_DIFFERENTIAL_COUNT,
  MEASURED_ESTIMATED_USAGE,
  MEASURED_RECOUNTED_USAGE,
} from '../../sources/measured-accounting.js'
import type { LocalEncoding } from '../../tokenizer/local.js'
import { distinctCitations } from '../accounting/shared.js'
import type { LlrTable, Probe, ProbeContext, Signal } from '../types.js'
import {
  BATTERY_COST,
  describeDeltas,
  isExact,
  localDeltas,
  meanAbsoluteDeviation,
  measuredDeltas,
  rewrittenCounts,
  tokenizerSignal,
} from './shared.js'

const ID = 'tokenizer/anthropic-differential'

const ENCODINGS: readonly LocalEncoding[] = Object.freeze(['o200k_base', 'cl100k_base'])

const SOURCES = distinctCitations([
  MEASURED_DIFFERENTIAL_COUNT,
  MEASURED_RECOUNTED_USAGE,
  ANTHROPIC_NEW_TOKENIZER,
])

function exactLlr(encoding: LocalEncoding, isNative: boolean): LlrTable {
  if (!isNative) {
    return { identity: { 'different-vendor': 0.2 }, translation: { translated: 0.5 } }
  }
  // The encoding of current OpenAI models says more about who answered than the older one,
  // and no Claude model counts with it - a cheaper one no more than the claimed one.
  return encoding === 'o200k_base'
    ? {
        identity: { 'different-vendor': 0.4, 'matches-claim': -0.4, 'same-vendor-cheaper': -0.4 },
        translation: { translated: 0.4 },
      }
    : { identity: { 'different-vendor': 0.3 }, translation: { translated: 0.5 } }
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { target } = context
  const measured = await measuredDeltas(context)
  if (measured === undefined) {
    return [
      tokenizerSignal(ID, {
        signalId: 'no-counts',
        calibration: 'derived',
        observed: 'At least one test prompt was answered without an input token count.',
        expected: 'An input token count with every answer.',
        llr: {},
        plainLanguage:
          "The endpoint did not report how many input tokens every test prompt used, so its counts could not be compared with OpenAI's encodings.",
        citations: SOURCES,
      }),
    ]
  }
  const rewritten = rewrittenCounts(
    ID,
    measured,
    distinctCitations([MEASURED_ESTIMATED_USAGE, MEASURED_DIFFERENTIAL_COUNT]),
  )
  if (rewritten !== undefined) {
    return [rewritten]
  }
  const locals = await Promise.all(
    ENCODINGS.map(async (encoding) => ({
      encoding,
      deltas: await localDeltas(encoding, context.nonce),
    })),
  )
  const margins = locals
    .map(
      ({ encoding, deltas }) =>
        `mean deviation ${meanAbsoluteDeviation(measured, deltas).toFixed(1)} from ${encoding}`,
    )
    .join(', ')
  const observed = `Input tokens added by each test string: ${describeDeltas(measured)} (${margins}).`
  const expected = `Deltas that match neither public encoding: ${locals.map(({ encoding, deltas }) => `${encoding} gives ${describeDeltas(deltas)}`).join('; ')}.`
  const exact = locals.find(({ deltas }) => isExact(measured, deltas))
  if (exact === undefined) {
    return [
      tokenizerSignal(ID, {
        signalId: 'not-openai-encoding',
        calibration: 'derived',
        observed,
        expected,
        llr: {},
        plainLanguage:
          "The reported input counts match neither of OpenAI's public encodings. Any tokenizer other than those two, Claude's included, gives this result, so it does not show which model answered.",
        citations: SOURCES,
      }),
    ]
  }
  return [
    tokenizerSignal(ID, {
      signalId: 'openai-encoding',
      calibration: 'derived',
      observed,
      expected,
      llr: exactLlr(exact.encoding, target.pairing === 'native'),
      plainLanguage: `The reported input counts match ${exact.encoding}, one of OpenAI's public encodings, token for token. Either an OpenAI model answered or a layer between you and the model recounted usage with that encoding.`,
      citations: SOURCES,
    }),
  ]
}

export const anthropicDifferential: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Input counts against OpenAI's encodings, for a Claude claim",
  group: 'C',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic'],
  needsKey: true,
  cost: BATTERY_COST,
  citations: [MEASURED_DIFFERENTIAL_COUNT, MEASURED_RECOUNTED_USAGE],
  run,
})
