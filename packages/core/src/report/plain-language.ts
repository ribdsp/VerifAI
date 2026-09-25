/**
 * The one sentence a buyer reads under the headline.
 *
 * It restates the assessment and nothing else: no number the report does not
 * hold, no finding the axes do not name, and no word about intent. A `fail`
 * says what the endpoint behaved like; a `caution` says what stood in the way
 * of a conclusion, because `caution` read as reassurance is the misreading this
 * sentence exists to prevent.
 */

import { ADVERSE_IDENTITY_FINDINGS, type Assessment, type Verdict } from '../types/assessment.js'
import type { Vendor } from '../types/target.js'
import { VENDOR_NAMES } from './labels.js'

export interface PlainLanguageInput {
  readonly headline: Verdict
  readonly assessment: Assessment
  readonly claimedModel: string
  readonly claimedVendor: Vendor
}

function failSentence(input: PlainLanguageInput): string {
  const { assessment, claimedModel: model } = input
  const vendor = VENDOR_NAMES[input.claimedVendor]
  if (assessment.consistency === 'fractional') {
    return `Repeating one identical check gave different answers, so only part of the requests to this endpoint appear to reach ${model}.`
  }
  switch (assessment.identity) {
    case 'same-vendor-cheaper':
      return `The endpoint answered like a cheaper or older ${vendor} model, not like ${model}.`
    case 'different-vendor':
      return `The endpoint answered like a model from a vendor other than ${vendor}, not like ${model}.`
    default:
      return "The endpoint's answers look canned or replayed rather than produced by a live model."
  }
}

function cautionSentence(input: PlainLanguageInput): string {
  const { assessment, claimedModel: model } = input
  if (
    ADVERSE_IDENTITY_FINDINGS.has(assessment.identity) ||
    assessment.consistency === 'fractional'
  ) {
    return `Some checks point away from ${model}, but not strongly enough to conclude that it is not being served.`
  }
  if (assessment.evidence === 'obstructed') {
    return 'The endpoint refused or failed too many checks to be cleared; that alone says nothing about which model it serves.'
  }
  if (assessment.identity === 'unknown') {
    return 'The checks that ran could not tell which model is answering.'
  }
  if (assessment.consistency === 'unknown') {
    return `The endpoint behaved like ${model} in the checks that ran, but too few repeated checks ran to tell whether every request reaches it.`
  }
  return `The endpoint behaved like ${model} in the checks that ran, but too few kinds of check ran to clear it.`
}

export function plainLanguageFor(input: PlainLanguageInput): string {
  switch (input.headline) {
    case 'pass':
      return `The endpoint behaved like ${input.claimedModel} in every check that ran, and repeated identical checks all agreed.`
    case 'fail':
      return failSentence(input)
    default:
      return cautionSentence(input)
  }
}
