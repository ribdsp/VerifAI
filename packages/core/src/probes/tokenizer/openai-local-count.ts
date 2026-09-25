/**
 * Whether an endpoint sold as an OpenAI model counts input the way the
 * encoding OpenAI's tokenizer library names for that model counts it.
 * OpenAI publishes its encodings, so the deltas a genuine backend reports for
 * the battery can be computed exactly here.
 *
 * An exact match with the claimed encoding is what a genuine backend gives,
 * and also what a layer that recounts usage with that encoding gives. An
 * exact match with the other public encoding is the count of an older OpenAI
 * model - or of a layer recounting with it. Counts that follow neither, by a
 * wide margin, were made by some other tokenizer: another vendor's model, or
 * a layer's own count. Every reading is derived from the library's model
 * table, not from OpenAI's API documentation, which names no encodings.
 */

import { openaiEncodingFor } from '@verifai/fingerprints'
import { ProbeNotApplicable } from '../../runner/errors.js'
import type { Citation } from '../../sources/citation.js'
import {
  MEASURED_DIFFERENTIAL_COUNT,
  MEASURED_ESTIMATED_USAGE,
  MEASURED_RECOUNTED_USAGE,
} from '../../sources/measured-accounting.js'
import { LOCAL_ENCODINGS, type LocalEncoding } from '../../tokenizer/local.js'
import { distinctCitations } from '../accounting/shared.js'
import type { LlrTable, Probe, ProbeContext, ProbeTarget, Signal } from '../types.js'
import {
  BATTERY_COST,
  type Deltas,
  describeDeltas,
  isExact,
  localDeltas,
  meanAbsoluteDeviation,
  measuredDeltas,
  rewrittenCounts,
  tokenizerSignal,
} from './shared.js'

const ID = 'tokenizer/openai-local-count'

/** A mean miss of two tokens per string is far outside any encoding's rounding. */
const FAR_DEVIATION = 2

function claimedEncoding(target: ProbeTarget): LocalEncoding | undefined {
  const encoding = openaiEncodingFor(target.claimedModel)?.value
  return encoding !== undefined && LOCAL_ENCODINGS.has(encoding) ? encoding : undefined
}

function otherEncoding(encoding: LocalEncoding): LocalEncoding {
  return encoding === 'o200k_base' ? 'cl100k_base' : 'o200k_base'
}

interface Reading {
  readonly signalId: string
  readonly llr: LlrTable
  readonly plainLanguage: string
}

function read(
  claimed: LocalEncoding,
  model: string,
  measured: Deltas,
  expected: Deltas,
  other: Deltas,
): Reading {
  if (isExact(measured, expected)) {
    return {
      signalId: 'claimed-encoding',
      llr: { identity: { 'matches-claim': 0.2, 'different-vendor': -0.4 } },
      plainLanguage: `The reported input counts match ${claimed}, the encoding OpenAI's tokenizer library names for ${JSON.stringify(model)}, token for token. A layer that recounts usage with the same public encoding would match too.`,
    }
  }
  if (isExact(measured, other)) {
    // o200k_base is the newer encoding; the models still on cl100k_base are older and cheaper.
    return claimed === 'o200k_base'
      ? {
          signalId: 'older-encoding',
          llr: {
            identity: { 'same-vendor-cheaper': 0.2, 'matches-claim': -0.4 },
            translation: { translated: 0.5 },
          },
          plainLanguage: `The reported input counts match cl100k_base, the encoding of older OpenAI models, token for token, not ${claimed}, which ${JSON.stringify(model)} uses. Either an older model answered or a layer recounted usage with the older encoding.`,
        }
      : {
          signalId: 'newer-encoding',
          llr: {
            identity: { 'same-vendor-cheaper': 0.5, 'matches-claim': -0.6 },
            translation: { translated: 0.3 },
          },
          plainLanguage: `The reported input counts match o200k_base, the encoding of newer OpenAI models, token for token, not ${claimed}, which ${JSON.stringify(model)} uses. Either a newer OpenAI model answered or a layer recounted usage with the newer encoding.`,
        }
  }
  const nearest = Math.min(
    meanAbsoluteDeviation(measured, expected),
    meanAbsoluteDeviation(measured, other),
  )
  if (nearest >= FAR_DEVIATION) {
    // Every OpenAI model in the library's table counts plain text with one of the two, a cheaper
    // one included.
    return {
      signalId: 'foreign-tokenizer',
      llr: {
        identity: { 'different-vendor': 0.4, 'matches-claim': -0.4, 'same-vendor-cheaper': -0.4 },
        translation: { translated: 0.3 },
      },
      plainLanguage: `The reported input counts follow neither of OpenAI's public encodings, missing the closer one by ${nearest.toFixed(1)} tokens per test string on average. Some other tokenizer counted them: another developer's model, or a layer's own count.`,
    }
  }
  return {
    signalId: 'near-encoding',
    llr: {},
    plainLanguage: `The reported input counts are close to OpenAI's public encodings but match neither exactly, missing by ${nearest.toFixed(1)} tokens per test string on average. That is too close to say another tokenizer counted them.`,
  }
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { target } = context
  const claimed = claimedEncoding(target)
  const encodingFact = openaiEncodingFor(target.claimedModel)
  if (claimed === undefined || encodingFact === undefined) {
    throw new ProbeNotApplicable('No public encoding is known for the claimed model.')
  }
  const sources: readonly Citation[] = [
    ...encodingFact.sources,
    MEASURED_DIFFERENTIAL_COUNT,
    MEASURED_RECOUNTED_USAGE,
  ]
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
        citations: distinctCitations(sources),
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
  const other = otherEncoding(claimed)
  const [expected, alternative] = await Promise.all([
    localDeltas(claimed, context.nonce),
    localDeltas(other, context.nonce),
  ])
  const reading = read(claimed, target.claimedModel, measured, expected, alternative)
  const margins = `mean deviation ${meanAbsoluteDeviation(measured, expected).toFixed(1)} from ${claimed}, ${meanAbsoluteDeviation(measured, alternative).toFixed(1)} from ${other}`
  return [
    tokenizerSignal(ID, {
      signalId: reading.signalId,
      calibration: 'derived',
      observed: `Input tokens added by each test string: ${describeDeltas(measured)} (${margins}).`,
      expected: `The deltas ${claimed} gives: ${describeDeltas(expected)}.`,
      llr: reading.llr,
      plainLanguage: reading.plainLanguage,
      citations: distinctCitations(sources),
    }),
  ]
}

export const openaiLocalCount: Probe = Object.freeze<Probe>({
  id: ID,
  title: "Input counts against OpenAI's public encodings",
  group: 'C',
  protocols: ['openai-chat', 'openai-responses'],
  vendors: ['openai'],
  applies: (target: ProbeTarget) => claimedEncoding(target) !== undefined,
  needsKey: true,
  cost: BATTERY_COST,
  citations: [MEASURED_DIFFERENTIAL_COUNT, MEASURED_RECOUNTED_USAGE],
  run,
})
