/**
 * Citations of this project's own published method and measurements.
 *
 * A signal whose expectation this project derived rather than a vendor stated
 * points at the document that says how, quoting it verbatim like any other
 * source, so the reader can check the reasoning instead of taking a number on
 * trust.
 */

import { citation } from './citation.js'

const SCORING = 'https://github.com/ribdsp/VerifAI/blob/main/docs/scoring.md'
const WRITTEN = '2026-09-24'

export const DILUTION_METHOD = citation(
  SCORING,
  'The input-token count of a fixed probe string, measured differentially, is the model example: the same model tokenizes the same string identically wherever it is hosted, while a different model generally does not.',
  WRITTEN,
)

export const UNIFORM_BOUND = citation(
  SCORING,
  '`uniform` bounds the share that could be going elsewhere; it does not certify that share is zero.',
  WRITTEN,
)
