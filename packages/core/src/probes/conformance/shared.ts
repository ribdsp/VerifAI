/**
 * What the vendors' conformance probes share: above all, how a request shape a
 * vendor documents a model as rejecting becomes evidence, for any vendor whose
 * docs settle, model by model, which shapes come back as a 400.
 *
 * A rejection matrix is the one kind of conformance probe that moves
 * `identity`, and only because the rejection is the model's. So only a refusal
 * speaks, for a model or against it. A layer in front of the model accepts
 * whatever it drops, whoever answers behind it, so an acceptance speaks for no
 * model and against none: answers that match a model by accepting alone do
 * not count for it - not for the claimed one, and not for a cheaper one of the
 * same vendor over another vendor's behind such a layer - and an acceptance
 * the docs rule out does not count against it, reading only on `translation`
 * as a layer that drops the setting. A refusal where the docs say a model
 * accepts does count against that model. A layer can refuse in its own words
 * too, so a refusal also speaks on `translation`, and nothing here moves
 * `different-vendor`.
 *
 * A cheaper model the docs are silent on for every cell sent is not ruled out:
 * silence is never evidence, in either direction.
 */

import type { Fact } from '@verifai/fingerprints'
import type { ErrorDialect } from '../../adapters/error-body.js'
import type { Citation } from '../../sources/citation.js'
import { errorOf, estimateTokens, generationRequest, isSuccess, quoted, signal } from '../shared.js'
import type {
  Exchange,
  LlrTable,
  ProbeContext,
  ProbeRequest,
  ProbeTarget,
  Signal,
} from '../types.js'

/** Asks for one word and names nothing. No matrix reads the answer. */
export const PROMPT = 'Reply with the word ok.'

/** What one request for a single token of `PROMPT` may bill. */
export const CELL_TOKENS = estimateTokens(PROMPT) + 1

/** The status a cell is sent expecting. */
export const REFUSAL: readonly number[] = Object.freeze([400])

/** A signal of the conformance family. */
export function conformanceSignal(spec: Omit<Signal, 'family'>): Signal {
  return signal({ ...spec, family: 'protocol-conformance' })
}

/** `maxTokens` of `PROMPT` with `extra` merged in, sent expecting a 400. */
export function refusableRequest(
  target: ProbeTarget,
  extra: Readonly<Record<string, unknown>>,
  maxTokens = 1,
): ProbeRequest {
  return Object.freeze({
    ...generationRequest(target, { prompt: PROMPT, maxTokens, extra }),
    provokes: REFUSAL,
  })
}

/** A response in a few words, for `observed`. */
export function describeAnswer(exchange: Exchange): string {
  const error = errorOf(exchange)
  if (error === undefined) {
    return isSuccess(exchange)
      ? `a ${exchange.status}`
      : `a ${exchange.status} without an error envelope`
  }
  const type = error.type === undefined ? '' : ` ${error.type}`
  const dialect = error.dialect === 'anthropic' ? "Anthropic's" : "OpenAI's"
  return `a ${exchange.status}${type} in ${dialect} error envelope, ${quoted(error.message)}`
}

/**
 * Each source once, in first-seen order.
 *
 * @throws TypeError for an empty list: a signal must cite something.
 */
export function uniqueCitations(list: readonly Citation[]): readonly [Citation, ...Citation[]] {
  const seen = new Set<string>()
  const [first, ...rest] = list.filter((entry) => {
    const key = `${entry.url}\n${entry.quote}`
    const fresh = !seen.has(key)
    seen.add(key)
    return fresh
  })
  if (first === undefined) {
    throw new TypeError('A signal must cite at least one source')
  }
  const unique: readonly [Citation, ...Citation[]] = [first, ...rest]
  return Object.freeze(unique)
}

export interface MatrixModel {
  readonly id: string
}

/** What a matrix needs to know of the vendor whose docs it reads. */
export interface MatrixVendor<M extends MatrixModel> {
  /** As prose names it: `Anthropic`. */
  readonly name: string
  /** The vendor's models, as prose names them: `Claude`. */
  readonly family: string
  /** The envelope the vendor's own refusals come in. */
  readonly dialect: ErrorDialect
  /** The model a `model` value names, or `undefined` if the docs list none. */
  readonly model: (id: string) => M | undefined
  /** The cheaper models a reseller billing for `id` could serve instead. */
  readonly cheaper: (id: string) => readonly M[]
  /** Where the vendor documents a refusal as a 400 `invalid_request_error` in its envelope. */
  readonly refusal: readonly [Citation, ...Citation[]]
}

/**
 * `rejected` is the 400 a vendor documents for a shape a model does not take:
 * `invalid_request_error`, in the vendor's envelope. Any other 400 is a
 * `foreign-rejection`: something refused the request in its own words.
 */
export type CellOutcome = 'accepted' | 'rejected' | 'foreign-rejection' | 'other'

/** The part of a documented rejection a matrix compares: its wording. */
export interface DocumentedRejection {
  readonly message: string
}

export interface RejectionCell<M extends MatrixModel> {
  /** What the cell sets, as `observed` names it: `temperature: 0.5`. */
  readonly sends: string
  readonly request: ProbeRequest
  /** Whether `model` rejects the cell. `undefined` where the docs are silent, which is never evidence. */
  readonly rejects: (model: M) => Fact<boolean> | undefined
  /** The documented wording of the rejection, in each of its variants. */
  readonly messages: readonly Fact<DocumentedRejection>[]
}

export interface CellResult<M extends MatrixModel> {
  readonly cell: RejectionCell<M>
  readonly exchange: Exchange
  readonly outcome: CellOutcome
}

/**
 * A request every model the vendor's table lists accepts, sent before the
 * cells. An endpoint that does not answer it is not answering the question the
 * cells ask, so the cells are not sent.
 */
export interface MatrixControl {
  readonly sends: string
  readonly request: ProbeRequest
  /** What the docs say of it, for `expected`. */
  readonly expected: string
  /** What a refusal of it means, for `plainLanguage`. */
  readonly plainLanguage: string
  readonly citations: readonly [Citation, ...Citation[]]
}

/** The cells the docs settle for `model`; the rest could not count for the claim. */
export function settledCells<M extends MatrixModel>(
  model: M,
  cells: readonly RejectionCell<M>[],
): readonly RejectionCell<M>[] {
  return Object.freeze(cells.filter((cell) => cell.rejects(model) !== undefined))
}

/** The matrix readings, bound to one vendor's docs. */
export interface RejectionMatrix<M extends MatrixModel> {
  readonly outcomeOf: (exchange: Exchange) => CellOutcome
  /** In order, one at a time, so a matrix never arrives as a burst. */
  readonly sendCells: (
    context: ProbeContext,
    cells: readonly RejectionCell<M>[],
  ) => Promise<readonly CellResult<M>[]>
  /** For `applies`: whether the docs settle any of the cells for the claimed model. */
  readonly documentsAny: (
    rejects: readonly RejectionCell<M>['rejects'][],
  ) => (target: ProbeTarget) => boolean
  /**
   * A matrix probe's `run`: the cells the docs settle for the claimed model,
   * sent in order after `control`, if there is one, and read together. A model
   * the docs do not list, or a matrix they are silent on for it, sends nothing
   * and says nothing.
   */
  readonly runMatrix: (
    context: ProbeContext,
    probeId: string,
    cells: readonly RejectionCell<M>[],
    control?: (model: M) => MatrixControl,
  ) => Promise<readonly Signal[]>
  /** Every signal a rejection matrix supports, for the claimed `model`. */
  readonly rejectionSignals: (
    probeId: string,
    model: M,
    results: readonly CellResult<M>[],
  ) => readonly Signal[]
  /** 400s outside the `invalid_request_error` in the vendor's envelope that its API documents. */
  readonly foreignRejectionSignals: (
    probeId: string,
    results: readonly CellResult<M>[],
  ) => readonly Signal[]
}

export function rejectionMatrix<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
): RejectionMatrix<M> {
  return Object.freeze({
    outcomeOf: (exchange: Exchange) => outcomeOf(vendor, exchange),
    sendCells: (context: ProbeContext, cells: readonly RejectionCell<M>[]) =>
      sendCells(vendor, context, cells),
    documentsAny: (rejects: readonly RejectionCell<M>['rejects'][]) =>
      documentsAny(vendor, rejects),
    runMatrix: (
      context: ProbeContext,
      probeId: string,
      cells: readonly RejectionCell<M>[],
      control?: (model: M) => MatrixControl,
    ) => runMatrix(vendor, context, probeId, cells, control),
    rejectionSignals: (probeId: string, model: M, results: readonly CellResult<M>[]) =>
      rejectionSignals(vendor, probeId, model, results),
    foreignRejectionSignals: (probeId: string, results: readonly CellResult<M>[]) =>
      foreignRejectionSignals(vendor, probeId, results),
  })
}

function outcomeOf<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  exchange: Exchange,
): CellOutcome {
  if (isSuccess(exchange)) {
    return 'accepted'
  }
  if (exchange.status !== 400) {
    return 'other'
  }
  const error = errorOf(exchange)
  return error?.dialect === vendor.dialect && error.type === 'invalid_request_error'
    ? 'rejected'
    : 'foreign-rejection'
}

async function sendCells<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  context: ProbeContext,
  cells: readonly RejectionCell<M>[],
): Promise<readonly CellResult<M>[]> {
  const results: CellResult<M>[] = []
  for (const cell of cells) {
    const exchange = await context.send(cell.request)
    results.push(Object.freeze({ cell, exchange, outcome: outcomeOf(vendor, exchange) }))
  }
  return Object.freeze(results)
}

function documentsAny<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  rejects: readonly RejectionCell<M>['rejects'][],
): (target: ProbeTarget) => boolean {
  return (target) => {
    const model = vendor.model(target.claimedModel)
    return model !== undefined && rejects.some((reject) => reject(model) !== undefined)
  }
}

async function runMatrix<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  context: ProbeContext,
  probeId: string,
  cells: readonly RejectionCell<M>[],
  control: ((model: M) => MatrixControl) | undefined,
): Promise<readonly Signal[]> {
  const model = vendor.model(context.target.claimedModel)
  const settled = model === undefined ? [] : settledCells(model, cells)
  if (model === undefined || settled.length === 0) {
    return Object.freeze([])
  }
  if (control !== undefined) {
    const refused = await sendControl(vendor, context, probeId, control(model))
    if (refused !== undefined) {
      return refused
    }
  }
  return rejectionSignals(vendor, probeId, model, await sendCells(vendor, context, settled))
}

/** What a control that was not accepted says, or `undefined` when it was and the cells may follow. */
async function sendControl<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  context: ProbeContext,
  probeId: string,
  control: MatrixControl,
): Promise<readonly Signal[] | undefined> {
  const [result] = await sendCells(vendor, context, [
    { sends: control.sends, request: control.request, rejects: () => undefined, messages: [] },
  ])
  if (result === undefined || result.outcome === 'accepted') {
    return undefined
  }
  if (result.outcome === 'foreign-rejection') {
    return foreignRejectionSignals(vendor, probeId, [result])
  }
  if (result.outcome !== 'rejected') {
    return Object.freeze([])
  }
  // Every model accepts the control, so its refusal says nothing of which one answered.
  return Object.freeze([
    conformanceSignal({
      probeId,
      signalId: 'control-rejected',
      calibration: 'documented',
      observed: `${control.sends} was refused with ${describeAnswer(result.exchange)}.`,
      expected: control.expected,
      llr: { platform: { 'first-party': -0.3 }, translation: { translated: 0.2 } },
      plainLanguage: control.plainLanguage,
      citations: control.citations,
    }),
  ])
}

interface Check<M extends MatrixModel> {
  readonly result: CellResult<M>
  readonly fact: Fact<boolean>
  readonly matches: boolean
}

interface Judgement<M extends MatrixModel> {
  readonly model: M
  /** Cells the docs settle for `model` and the endpoint answered decisively. */
  readonly checks: readonly Check<M>[]
}

function judge<M extends MatrixModel>(model: M, results: readonly CellResult<M>[]): Judgement<M> {
  const checks = results.flatMap((result): Check<M>[] => {
    const fact = result.cell.rejects(model)
    if (fact === undefined || (result.outcome !== 'accepted' && result.outcome !== 'rejected')) {
      return []
    }
    return [{ result, fact, matches: (result.outcome === 'rejected') === fact.value }]
  })
  return { model, checks }
}

const isJudged = <M extends MatrixModel>(judgement: Judgement<M>): boolean =>
  judgement.checks.length > 0

const isConsistent = <M extends MatrixModel>(judgement: Judgement<M>): boolean =>
  judgement.checks.every((check) => check.matches)

const refusesAny = <M extends MatrixModel>(judgement: Judgement<M>): boolean =>
  judgement.checks.some((check) => check.result.outcome === 'rejected')

/** Whether an answer of `outcome` differs from what the docs say for the model. */
const differsBy = <M extends MatrixModel>(
  judgement: Judgement<M>,
  outcome: 'accepted' | 'rejected',
): boolean => judgement.checks.some((check) => !check.matches && check.result.outcome === outcome)

const IDENTITY_MATCH = 0.3
const IDENTITY_MISMATCH = -0.4
const NAMED_MODELS = 3

function sendsList<M extends MatrixModel>(
  checks: readonly Check<M>[],
  word: (check: Check<M>) => string,
): string {
  return checks.map((check) => `${check.result.cell.sends} ${word(check)}`).join('; ')
}

/** Up to three model IDs, and a note that there are more. */
function namesOf<M extends MatrixModel>(judgements: readonly Judgement<M>[]): string {
  const names = judgements.slice(0, NAMED_MODELS).map((judgement) => judgement.model.id)
  const more = judgements.length > NAMED_MODELS ? ' and others' : ''
  return `${names.join(', ')}${more}`
}

function substituteSentence<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  claim: Judgement<M>,
  substitutes: readonly Judgement<M>[],
): string {
  if (substitutes.length === 0) {
    return `No cheaper ${vendor.family} model is documented to answer the same way.`
  }
  const tie = isConsistent(claim) ? ', so these answers do not tell them apart' : ''
  return `${vendor.name} documents the answers this endpoint gave for the cheaper ${namesOf(substitutes)}${tie}.`
}

function silenceSentence<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  silent: readonly Judgement<M>[],
): readonly string[] {
  if (silent.length === 0) {
    return []
  }
  return [
    `${vendor.name} documents none of these answers for the cheaper ${namesOf(silent)}, so this does not rule them out.`,
  ]
}

/**
 * What a judgement says for its model: against it when a refusal differs from
 * the docs, for it when every answer matches and one is a refusal, and nothing
 * otherwise - when they match by accepting alone, when only an acceptance
 * differs, which a layer that drops the setting explains for any model, or
 * when the docs settle none of them.
 */
function reading<M extends MatrixModel>(judgement: Judgement<M>): number | undefined {
  if (differsBy(judgement, 'rejected')) {
    return IDENTITY_MISMATCH
  }
  return isConsistent(judgement) && refusesAny(judgement) ? IDENTITY_MATCH : undefined
}

/**
 * The best any cheaper model reads, or `undefined` when there is none or one
 * says nothing: a model the answers do not rule out keeps the substitution open.
 */
function cheaperReading<M extends MatrixModel>(
  cheaper: readonly Judgement<M>[],
): number | undefined {
  const readings = cheaper.map(reading)
  if (readings.includes(IDENTITY_MATCH)) {
    return IDENTITY_MATCH
  }
  return readings.length === 0 || readings.includes(undefined) ? undefined : IDENTITY_MISMATCH
}

function identityLlr<M extends MatrixModel>(
  claim: Judgement<M>,
  cheaper: readonly Judgement<M>[],
): LlrTable {
  const claimed = reading(claim)
  const substituted = cheaperReading(cheaper)
  if (claimed === undefined && substituted === undefined) {
    return {}
  }
  return {
    identity: {
      ...(claimed === undefined ? {} : { 'matches-claim': claimed }),
      ...(substituted === undefined ? {} : { 'same-vendor-cheaper': substituted }),
    },
  }
}

const ACCEPTANCE_ALONE =
  'A layer that drops these settings accepts them too, whatever model is behind it, so acceptance alone does not show which model answered.'
const ACCEPTANCE_DROPPED =
  'A layer that drops some settings accepts them whatever model is behind it, so an acceptance the docs rule out does not count against the claim.'

function identitySignal<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  probeId: string,
  claim: Judgement<M>,
  results: readonly CellResult<M>[],
): readonly Signal[] {
  if (!isJudged(claim)) {
    return []
  }
  const cheaper = vendor.cheaper(claim.model.id).map((model) => judge(model, results))
  const substitutes = cheaper.filter((judgement) => isJudged(judgement) && isConsistent(judgement))
  const silent = cheaper.filter((judgement) => !isJudged(judgement))
  const opening = isConsistent(claim)
    ? `The endpoint accepted and refused these settings as ${vendor.name} documents for ${claim.model.id}.`
    : `The endpoint accepted or refused some of these settings differently from what ${vendor.name} documents for ${claim.model.id}.`
  const acceptedAlone = !refusesAny(claim) && !substitutes.some(refusesAny)
  const dropped = !acceptedAlone && differsBy(claim, 'accepted') && !differsBy(claim, 'rejected')
  return [
    conformanceSignal({
      probeId,
      signalId: 'documented-rejections',
      calibration: 'documented',
      observed: `${sendsList(claim.checks, (check) => `was ${check.result.outcome}`)}.`,
      expected: `For ${claim.model.id}, ${vendor.name} documents: ${sendsList(claim.checks, (check) => (check.fact.value ? 'rejected' : 'accepted'))}.`,
      llr: identityLlr(claim, cheaper),
      plainLanguage: [
        opening,
        substituteSentence(vendor, claim, substitutes),
        ...silenceSentence(vendor, silent),
        ...(acceptedAlone ? [ACCEPTANCE_ALONE] : []),
        ...(dropped ? [ACCEPTANCE_DROPPED] : []),
      ].join(' '),
      citations: uniqueCitations([
        ...claim.checks.flatMap((check) => check.fact.sources),
        ...substitutes.flatMap((judgement) =>
          judgement.checks.map((check) => check.fact.sources[0]),
        ),
      ]),
    }),
  ]
}

function strippedSignal<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  probeId: string,
  claim: Judgement<M>,
): readonly Signal[] {
  const stripped = claim.checks.filter((check) => !check.matches && check.fact.value)
  if (stripped.length === 0) {
    return []
  }
  return [
    conformanceSignal({
      probeId,
      signalId: 'accepted-where-documented-rejected',
      calibration: 'heuristic',
      observed: `${sendsList(stripped, (check) => `was answered ${check.result.exchange.status}`)}.`,
      expected: `A 400 for each, which ${vendor.name} documents for ${claim.model.id}.`,
      llr: { translation: { translated: 0.2 } },
      plainLanguage:
        'A layer that removes these settings before the request reaches the model would produce the same answers.',
      citations: uniqueCitations(stripped.flatMap((check) => check.fact.sources)),
    }),
  ]
}

function foreignRejectionSignals<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  probeId: string,
  results: readonly CellResult<M>[],
): readonly Signal[] {
  const foreign = results.filter((result) => result.outcome === 'foreign-rejection')
  if (foreign.length === 0) {
    return Object.freeze([])
  }
  return Object.freeze([
    conformanceSignal({
      probeId,
      signalId: 'foreign-rejection',
      calibration: 'heuristic',
      observed: `${foreign.map((result) => `${result.cell.sends} was refused with ${describeAnswer(result.exchange)}`).join('; ')}.`,
      expected: `A request shape a model does not take is refused with a 400 invalid_request_error in ${vendor.name}'s error envelope.`,
      llr: { translation: { translated: 0.2 } },
      plainLanguage: `The endpoint refused a request, but not in the form ${vendor.name}'s API uses. Something in front of the model checked the request itself.`,
      citations: vendor.refusal,
    }),
  ])
}

function hasDocumentedWording<M extends MatrixModel>(result: CellResult<M>): boolean {
  const message = errorOf(result.exchange)?.message ?? ''
  return result.cell.messages.some((fact) => message.includes(fact.value.message))
}

function wordingSignal<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  probeId: string,
  results: readonly CellResult<M>[],
): readonly Signal[] {
  const worded = results.filter(
    (result) => result.outcome === 'rejected' && result.cell.messages.length > 0,
  )
  if (worded.length === 0) {
    return []
  }
  const reworded = worded.filter((result) => !hasDocumentedWording(result))
  const documented = reworded.length === 0
  return [
    conformanceSignal({
      probeId,
      signalId: 'rejection-wording',
      calibration: documented ? 'documented' : 'heuristic',
      observed: `${(documented ? worded : reworded).map((result) => `${result.cell.sends} was refused with ${quoted(errorOf(result.exchange)?.message ?? '')}`).join('; ')}.`,
      expected: `${worded.map((result) => `${result.cell.sends}: ${result.cell.messages.map((fact) => quoted(fact.value.message)).join(' or ')}`).join('; ')}.`,
      llr: documented
        ? { translation: { direct: 0.3 }, platform: { 'first-party': 0.2 } }
        : { translation: { translated: 0.2 }, platform: { 'first-party': -0.2 } },
      plainLanguage: documented
        ? `The endpoint refused these settings in the exact words ${vendor.name}'s own API uses.`
        : `The endpoint refused these settings in ${vendor.name}'s error format, but not in the words ${vendor.name} documents for them.`,
      citations: uniqueCitations(
        worded.flatMap((result) => result.cell.messages.flatMap((fact) => fact.sources)),
      ),
    }),
  ]
}

function rejectionSignals<M extends MatrixModel>(
  vendor: MatrixVendor<M>,
  probeId: string,
  model: M,
  results: readonly CellResult<M>[],
): readonly Signal[] {
  const claim = judge(model, results)
  return Object.freeze([
    ...identitySignal(vendor, probeId, claim, results),
    ...strippedSignal(vendor, probeId, claim),
    ...foreignRejectionSignals(vendor, probeId, results),
    ...wordingSignal(vendor, probeId, results),
  ])
}
