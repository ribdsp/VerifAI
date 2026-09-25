/**
 * The `system_fingerprint` of a chat completion sold as an OpenAI model.
 * OpenAI's reference marks the field optional, shows it as `null`, and shows
 * it as `fp_` and ten hex digits; nothing else is specified, so every reading
 * here is heuristic.
 *
 * An empty string is what Anthropic's OpenAI-compatible endpoint documents it
 * always returns, and what platforms that resell the genuine GPT model send
 * as well - Snowflake Cortex does - so it says a layer other than OpenAI's own
 * API wrote the response, not which model is behind it. A value in another
 * shape was written by a layer that answers in OpenAI's format; one that
 * leaves the field out entirely rebuilt the response without it.
 */

import { openaiFingerprintExpectation } from '@verifai/fingerprints'
import { ProbeNotApplicable } from '../../runner/errors.js'
import { ANTHROPIC_COMPAT_FINGERPRINT_EMPTY } from '../../sources/anthropic-conformance-common.js'
import type { Citation } from '../../sources/citation.js'
import { OPENAI_SYSTEM_FINGERPRINT } from '../../sources/openai-conformance.js'
import { quoted } from '../shared.js'
import type { LlrTable, Probe, ProbeContext, ProbeTarget, Signal } from '../types.js'
import { accountingSignal, BASELINE_COST, baseline, distinctCitations } from './shared.js'

const ID = 'accounting/system-fingerprint'

interface Reading {
  readonly signalId: string
  readonly llr: LlrTable
  readonly citations: readonly Citation[]
  readonly plainLanguage: string
}

function read(fingerprint: string | null | undefined, pattern: RegExp): Reading {
  if (fingerprint === undefined) {
    return {
      signalId: 'absent',
      llr: { translation: { translated: 0.2 } },
      citations: [],
      plainLanguage:
        "The response had no system_fingerprint field. Every example response in OpenAI's reference has one, sometimes null; a layer between you and the model built this response without it.",
    }
  }
  if (fingerprint === null || pattern.test(fingerprint)) {
    return {
      signalId: 'openai-shaped',
      llr: {},
      citations: [],
      plainLanguage:
        "The response's system_fingerprint looks like the ones OpenAI's API returns. Anything that copies the format can produce the same value, so this does not show who answered.",
    }
  }
  if (fingerprint === '') {
    return {
      signalId: 'empty',
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
      citations: [ANTHROPIC_COMPAT_FINGERPRINT_EMPTY],
      plainLanguage:
        "The response's system_fingerprint was empty. OpenAI's examples show either null or a value; Anthropic documents that its OpenAI-compatible endpoint always leaves the field empty, and platforms that resell the genuine GPT model can leave it empty too. So a layer other than OpenAI's own API wrote this response, and the empty value does not say which model answered.",
    }
  }
  return {
    signalId: 'foreign-shape',
    llr: { identity: { 'different-vendor': 0.2 }, translation: { translated: 0.2 } },
    citations: [],
    plainLanguage:
      "The response's system_fingerprint is not shaped like the ones OpenAI's API returns. A layer that answers in OpenAI's format wrote it; OpenAI could also change its format.",
  }
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const expectation = openaiFingerprintExpectation(context.target.claimedModel)
  if (expectation === undefined) {
    throw new ProbeNotApplicable('OpenAI documents no system_fingerprint for this model.')
  }
  const { systemFingerprint } = (await baseline(context)).generation
  const { pattern } = expectation.value
  const reading = read(systemFingerprint, new RegExp(pattern))
  return [
    accountingSignal(ID, {
      signalId: reading.signalId,
      calibration: 'heuristic',
      observed:
        systemFingerprint === undefined
          ? 'The response had no system_fingerprint.'
          : `The response's system_fingerprint was ${systemFingerprint === null ? 'null' : quoted(systemFingerprint)}.`,
      expected: `A system_fingerprint that is null or matches ${pattern}.`,
      llr: reading.llr,
      plainLanguage: reading.plainLanguage,
      citations: distinctCitations([...expectation.sources, ...reading.citations]),
    }),
  ]
}

export const systemFingerprint: Probe = Object.freeze<Probe>({
  id: ID,
  title: "A system_fingerprint shaped like OpenAI's",
  group: 'B',
  protocols: ['openai-chat'],
  vendors: ['openai'],
  applies: (target: ProbeTarget) => openaiFingerprintExpectation(target.claimedModel) !== undefined,
  needsKey: true,
  cost: BASELINE_COST,
  citations: [OPENAI_SYSTEM_FINGERPRINT],
  run,
})
