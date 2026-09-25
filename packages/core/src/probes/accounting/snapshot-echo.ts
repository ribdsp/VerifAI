/**
 * Which model the response says produced it. Both vendors define the
 * response's `model` as the model that handled the request, so a genuine
 * backend names the claimed model - or, for an alias, the snapshot the alias
 * resolves to.
 *
 * The name is compared after undoing the spellings clouds and routers add,
 * so `anthropic.claude-sonnet-4-5-20250929-v1:0` is the model it names, not a
 * different one. A name that is still different moves the identity axis by
 * what it names: a cheaper model of the same vendor, another vendor's model,
 * another developer's model family, or nothing either vendor lists. Anything
 * in between can copy the claimed name, so a match proves nothing.
 */

import {
  type AnthropicModel,
  anthropicModel,
  cheaperAnthropicModels,
  openaiEncodingFor,
  openaiSnapshotFor,
} from '@verifai/fingerprints'
import {
  ANTHROPIC_BEDROCK_DATED_ID,
  ANTHROPIC_BEDROCK_V1_SUFFIX,
  ANTHROPIC_RESPONSE_MODEL,
  ANTHROPIC_VERTEX_DATED_ID,
} from '../../sources/anthropic-accounting.js'
import type { Citation } from '../../sources/citation.js'
import {
  MEASURED_MODEL_SPELLINGS,
  MEASURED_OTHER_FAMILIES,
} from '../../sources/measured-accounting.js'
import {
  OPENAI_CHAT_RESPONSE_MODEL,
  OPENAI_RESPONSES_MODEL,
} from '../../sources/openai-accounting.js'
import type { Protocol, Vendor } from '../../types/target.js'
import { quoted } from '../shared.js'
import type { Calibration, LlrTable, Probe, ProbeContext, ProbeTarget, Signal } from '../types.js'
import { accountingSignal, BASELINE_COST, baseline, distinctCitations } from './shared.js'

const ID = 'accounting/snapshot-echo'

const ECHO_SOURCES: Readonly<Record<Protocol, Citation>> = Object.freeze({
  'anthropic-messages': ANTHROPIC_RESPONSE_MODEL,
  'openai-chat': OPENAI_CHAT_RESPONSE_MODEL,
  'openai-responses': OPENAI_RESPONSES_MODEL,
})

const REGION_PREFIX = /^(?:us|eu|apac|global)\./
const VENDOR_PREFIX = /^(?:anthropic[./]|openai\/)/
const VERSION_SUFFIX = /-v\d+(?::\d+)?$/
/** Bedrock's `anthropic.` prefix and `-v1:0` suffix, and Google Cloud's `@` before a date. */
const PARTNER_SPELLING = /^(?:(?:us|eu|apac|global)\.)?anthropic\.|@|-v\d+(?::\d+)?$/

const OPENAI_NAME = /^(?:gpt-|chatgpt-|o\d)/
const CLAUDE_NAME = /^claude-/
const OTHER_FAMILY =
  /(?:^|[/.:_-])(?:deepseek|qwen|qwq|llama|mistral|mixtral|codestral|gemini|gemma|glm|kimi|moonshot|grok|ernie|hunyuan|doubao|minimax)/
/** OpenAI's names for its smaller, cheaper variants. */
const SMALLER_OPENAI = /-(?:mini|nano)(?:-|$)/

/** `name` with the spellings of clouds and routers undone. */
export function normalizeModelName(name: string): string {
  const bare = name
    .trim()
    .toLowerCase()
    .replace(REGION_PREFIX, '')
    .replace(VENDOR_PREFIX, '')
    .replaceAll('@', '-')
    .replace(VERSION_SUFFIX, '')
  return CLAUDE_NAME.test(bare) ? bare.replace(/(\d)\.(\d)/g, '$1-$2') : bare
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every `model` a genuine backend may echo for the claim, and the facts that say so. */
interface Accepted {
  readonly names: readonly string[]
  /** A dated snapshot of an undated claim: `gpt-5` answered as `gpt-5-2025-08-07`. */
  readonly dated: RegExp | undefined
  readonly citations: readonly Citation[]
}

/** The claim's accepted names, and the name the request carried when a gateway renamed it. */
function accepted(target: ProbeTarget): Accepted {
  const documented = documentedNames(target)
  return target.requestedModel === target.claimedModel
    ? documented
    : { ...documented, names: [...new Set([target.requestedModel, ...documented.names])] }
}

function documentedNames(target: ProbeTarget): Accepted {
  const claimed = target.claimedModel
  if (target.claimedVendor === 'anthropic') {
    const model = anthropicModel(claimed)
    return model === undefined
      ? { names: [claimed], dated: undefined, citations: [] }
      : {
          names: [...new Set([claimed, model.id, ...model.aliases.value])],
          dated: undefined,
          citations: [model.idSource],
        }
  }
  const snapshot = openaiSnapshotFor(claimed)
  const dated = new RegExp(`^${escapeRegExp(claimed.toLowerCase())}-\\d{4}-\\d{2}-\\d{2}$`)
  if (snapshot === undefined) {
    return { names: [claimed], dated, citations: [] }
  }
  const { value } = snapshot
  return value.kind === 'pinned'
    ? { names: [value.echo], dated: undefined, citations: snapshot.sources }
    : { names: [value.alias, ...value.candidates], dated, citations: snapshot.sources }
}

function isAccepted(name: string, allowed: Accepted): boolean {
  return allowed.names.includes(name) || (allowed.dated?.test(name) ?? false)
}

interface Reading {
  readonly signalId: string
  readonly calibration: Calibration
  readonly llr: LlrTable
  readonly citations: readonly Citation[]
  readonly plainLanguage: string
}

function renamed(echo: string, claimed: string): Reading {
  const isPartner = PARTNER_SPELLING.test(echo.toLowerCase())
  return {
    signalId: 'renamed',
    calibration: 'heuristic',
    llr: isPartner
      ? { platform: { 'partner-cloud': 0.2 }, translation: { translated: 0.1 } }
      : { translation: { translated: 0.2 } },
    citations: isPartner
      ? [
          MEASURED_MODEL_SPELLINGS,
          ANTHROPIC_BEDROCK_DATED_ID,
          ANTHROPIC_BEDROCK_V1_SUFFIX,
          ANTHROPIC_VERTEX_DATED_ID,
        ]
      : [MEASURED_MODEL_SPELLINGS],
    plainLanguage: isPartner
      ? `The response names ${quoted(claimed)}, the model you asked for, spelled the way a cloud platform that resells the vendor's models spells it rather than the way the vendor's own API does.`
      : `The response names ${quoted(claimed)}, the model you asked for, spelled differently from the vendor's own API.`,
  }
}

/** An echo that names a Claude model Anthropic lists, other than the one claimed. */
function listedClaude(target: ProbeTarget, echo: string, model: AnthropicModel): Reading {
  const isNative = target.pairing === 'native'
  const claimed = target.claimedModel
  const isCheaper = cheaperAnthropicModels(claimed).some((other) => other.id === model.id)
  if (!isCheaper) {
    return {
      signalId: 'other-claude',
      calibration: isNative ? 'documented' : 'heuristic',
      llr: { identity: { 'matches-claim': isNative ? -0.6 : -0.3 } },
      citations: [model.idSource],
      plainLanguage: `The response says it was produced by ${model.displayName} (${quoted(echo)}), a different Claude model from ${quoted(claimed)}, the one you asked for.`,
    }
  }
  const priced = [anthropicModel(claimed)?.pricing, model.pricing].flatMap((pricing) =>
    pricing === undefined ? [] : pricing.sources,
  )
  return {
    signalId: 'cheaper-model',
    calibration: isNative ? 'documented' : 'heuristic',
    llr: isNative
      ? { identity: { 'same-vendor-cheaper': 0.8, 'matches-claim': -0.8 } }
      : { identity: { 'same-vendor-cheaper': 0.3, 'matches-claim': -0.3 } },
    citations: [model.idSource, ...priced],
    plainLanguage: `The response says it was produced by ${model.displayName} (${quoted(echo)}), which Anthropic prices below ${quoted(claimed)}, the model you asked for.`,
  }
}

function anthropicEcho(target: ProbeTarget, echo: string, name: string): Reading | undefined {
  const claimed = target.claimedModel
  const model = anthropicModel(name)
  if (model !== undefined) {
    return listedClaude(target, echo, model)
  }
  if (CLAUDE_NAME.test(name)) {
    return {
      signalId: 'unlisted-claude',
      calibration: 'heuristic',
      llr: { identity: { 'same-vendor-cheaper': 0.2, 'matches-claim': -0.3 } },
      citations: [],
      plainLanguage: `The response says it was produced by ${quoted(echo)}, a Claude name Anthropic's current documentation does not list, while you asked for ${quoted(claimed)}.`,
    }
  }
  if (OPENAI_NAME.test(name)) {
    // Documented only where a page lists the name; the tokenizer tables still say it is OpenAI's.
    const snapshot = openaiSnapshotFor(name)
    const sources = snapshot?.sources ?? openaiEncodingFor(name)?.sources ?? []
    return otherVendor(echo, target, target.pairing === 'native' && snapshot !== undefined, sources)
  }
  return undefined
}

function openaiEcho(target: ProbeTarget, echo: string, name: string): Reading | undefined {
  const claimed = target.claimedModel
  if (CLAUDE_NAME.test(name)) {
    const model = anthropicModel(name)
    const isDocumented = target.pairing === 'native' && model !== undefined
    return otherVendor(echo, target, isDocumented, model === undefined ? [] : [model.idSource])
  }
  if (OPENAI_NAME.test(name)) {
    const isSmaller = SMALLER_OPENAI.test(name) && !SMALLER_OPENAI.test(claimed.toLowerCase())
    return {
      signalId: isSmaller ? 'smaller-model' : 'other-gpt',
      calibration: 'heuristic',
      llr: isSmaller
        ? { identity: { 'same-vendor-cheaper': 0.3, 'matches-claim': -0.3 } }
        : { identity: { 'matches-claim': -0.3 } },
      citations: openaiSnapshotFor(name)?.sources ?? [],
      plainLanguage: isSmaller
        ? `The response says it was produced by ${quoted(echo)}, one of OpenAI's smaller models, while you asked for ${quoted(claimed)}.`
        : `The response says it was produced by ${quoted(echo)}, a different OpenAI model from ${quoted(claimed)}, the one you asked for.`,
    }
  }
  return undefined
}

const VENDOR_NAMES: Readonly<Record<Vendor, string>> = Object.freeze({
  anthropic: 'Anthropic',
  openai: 'OpenAI',
})

function otherVendor(
  echo: string,
  target: ProbeTarget,
  isDocumented: boolean,
  sources: readonly Citation[],
): Reading {
  const claimedVendor = VENDOR_NAMES[target.claimedVendor]
  const echoVendor =
    target.claimedVendor === 'anthropic' ? VENDOR_NAMES.openai : VENDOR_NAMES.anthropic
  return {
    signalId: 'other-vendor',
    calibration: isDocumented ? 'documented' : 'derived',
    llr: isDocumented
      ? { identity: { 'different-vendor': 0.8, 'matches-claim': -0.6 } }
      : { identity: { 'different-vendor': 0.6, 'matches-claim': -0.5 } },
    citations: sources,
    plainLanguage: `The response says it was produced by ${quoted(echo)}, an ${echoVendor} model, while you asked for ${quoted(target.claimedModel)}, an ${claimedVendor} model.`,
  }
}

function read(target: ProbeTarget, allowed: Accepted, echo: string | undefined): Reading {
  const claimed = target.claimedModel
  if (echo === undefined) {
    return {
      signalId: 'missing',
      calibration: 'documented',
      llr: {},
      citations: [],
      plainLanguage: 'The response did not say which model produced it.',
    }
  }
  if (echo.trim() === '') {
    // Some platforms that resell the genuine model send it empty.
    return {
      signalId: 'empty',
      calibration: 'heuristic',
      llr: { platform: { 'first-party': -0.2 }, translation: { translated: 0.2 } },
      citations: [],
      plainLanguage:
        "The response's model was empty. The vendor's own API names the model there, so a layer between you and the model rebuilt this response; an empty name does not say which model answered.",
    }
  }
  if (isAccepted(echo, allowed)) {
    return {
      signalId: 'matches',
      calibration: 'documented',
      llr: {},
      citations: allowed.citations,
      plainLanguage: `The response names ${quoted(echo)}, the model you asked for. Anything between you and the model can copy the name, so this alone does not show which model answered.`,
    }
  }
  const name = normalizeModelName(echo)
  const normalized: Accepted = {
    names: allowed.names.map(normalizeModelName),
    dated: allowed.dated,
    citations: allowed.citations,
  }
  if (isAccepted(name, normalized)) {
    return renamed(echo, claimed)
  }
  const reading =
    target.claimedVendor === 'anthropic'
      ? anthropicEcho(target, echo, name)
      : openaiEcho(target, echo, name)
  if (reading !== undefined) {
    return reading
  }
  if (OTHER_FAMILY.test(name)) {
    return {
      signalId: 'other-family',
      calibration: 'derived',
      llr: { identity: { 'different-vendor': 0.6, 'matches-claim': -0.6 } },
      citations: [MEASURED_OTHER_FAMILIES],
      plainLanguage: `The response says it was produced by ${quoted(echo)}, a name neither Anthropic nor OpenAI uses for its models, while you asked for ${quoted(claimed)}.`,
    }
  }
  return {
    signalId: 'unrecognised',
    calibration: 'heuristic',
    llr: { identity: { 'different-vendor': 0.2 }, translation: { translated: 0.2 } },
    citations: [],
    plainLanguage: `The response names ${quoted(echo)}, which is neither the model you asked for nor a model the vendor lists.`,
  }
}

async function run(context: ProbeContext): Promise<readonly Signal[]> {
  const { target } = context
  const echo = (await baseline(context)).generation.model
  const allowed = accepted(target)
  const reading = read(target, allowed, echo)
  const asked = quoted(target.requestedModel)
  const dated = allowed.dated === undefined ? '' : `, or ${quoted(target.claimedModel)} with a date`
  return [
    accountingSignal(ID, {
      signalId: reading.signalId,
      calibration: reading.calibration,
      observed:
        echo === undefined
          ? `The response had no model; the request named ${asked}.`
          : `The response's model was ${quoted(echo)}; the request named ${asked}.`,
      expected: `A model of ${allowed.names.map((name) => quoted(name)).join(', ')}${dated}.`,
      llr: reading.llr,
      plainLanguage: reading.plainLanguage,
      citations: distinctCitations([ECHO_SOURCES[target.protocol], ...reading.citations]),
    }),
  ]
}

export const snapshotEcho: Probe = Object.freeze<Probe>({
  id: ID,
  title: 'The model the response names',
  group: 'B',
  protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
  vendors: ['anthropic', 'openai'],
  needsKey: true,
  cost: BASELINE_COST,
  citations: [ANTHROPIC_RESPONSE_MODEL, OPENAI_CHAT_RESPONSE_MODEL, OPENAI_RESPONSES_MODEL],
  run,
})
