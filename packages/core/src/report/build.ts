/**
 * Turns a finished run and its scoring into the canonical report.
 *
 * Three rules from `docs/report-format.md` are enforced here rather than
 * trusted to the callers:
 *
 * - **No key, anywhere.** Every string in the finished document passes through
 *   the redactor, not only the ones that obviously came from the endpoint: a
 *   signal's `observed` text can quote an error body, and an error body can
 *   quote the key.
 * - **The endpoint is hashed.** `endpoint` is plaintext only when the buyer
 *   asked for it; `endpointHash` is always there, so two reports about the
 *   same endpoint can be matched without either publishing it.
 * - **The headline is derived.** It is recomputed from the assessment and the
 *   confidence, and a disagreement is a construction error.
 */

import { targetAuth } from '../adapters/adapter.js'
import type { Endpoint } from '../adapters/endpoint.js'
import { createRedactor, type Redactor } from '../credentials/redact.js'
import type { ProbeTarget } from '../probes/types.js'
import { sha256Text } from '../runner/exchange.js'
import type { RunResult } from '../runner/types.js'
import type { Scored } from '../scoring/assess.js'
import { verdictFor } from '../types/assessment.js'
import { plainLanguageFor } from './plain-language.js'
import { REPORT_VERSION, type Report, type ReportRun } from './types.js'

export interface ReportInput {
  readonly toolVersion: string
  readonly fingerprintsVersion: string
  readonly run: ReportRun
  readonly target: ProbeTarget
  /** Publish the endpoint in plaintext. Off unless the buyer asked. */
  readonly showEndpoint: boolean
  readonly result: RunResult
  readonly scored: Scored
  /** Every secret the run held. Each is redacted from every string in the report. */
  readonly secrets: readonly string[]
}

/** `sha256:` over the normalised API root, the identity two reports are matched on. */
export function endpointHash(endpoint: Endpoint): Promise<string> {
  return sha256Text(endpoint.root)
}

/** A frozen copy of `value` with every string redacted. JSON values only. */
function redactDeep<T>(value: T, redact: Redactor): T {
  if (typeof value === 'string') {
    return redact(value) as T
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item: unknown) => redactDeep(item, redact))) as T
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)])
    return Object.freeze(Object.fromEntries(entries)) as T
  }
  return value
}

export async function buildReport(input: ReportInput): Promise<Report> {
  const { scored, target, result } = input
  const headline = verdictFor(scored.assessment, scored.confidence)
  if (headline !== scored.headline) {
    throw new TypeError('A report headline must be the one its assessment and confidence give')
  }

  const report: Report = {
    reportVersion: REPORT_VERSION,
    tool: { name: 'verifai', version: input.toolVersion },
    fingerprintsVersion: input.fingerprintsVersion,
    run: input.run,
    target: {
      endpointHash: await endpointHash(target.endpoint),
      endpoint: input.showEndpoint ? target.endpoint.root : null,
      protocol: target.protocol,
      claimedVendor: target.claimedVendor,
      claimedModel: target.claimedModel,
      requestedModel: target.requestedModel,
      pairing: target.pairing,
      auth: targetAuth(target),
    },
    verdict: {
      headline,
      assessment: scored.assessment,
      confidence: scored.confidence,
      confidenceCeiling: scored.ceiling.value,
      ceilingReasons: scored.ceiling.reasons,
      plainLanguage: plainLanguageFor({
        headline,
        assessment: scored.assessment,
        claimedModel: target.claimedModel,
        claimedVendor: target.claimedVendor,
      }),
      epsilon: scored.epsilon,
    },
    posteriors: scored.posteriors,
    signals: result.signals,
    skipped: result.skipped,
    evidence: result.evidence,
  }
  return redactDeep(report, createRedactor(input.secrets))
}
