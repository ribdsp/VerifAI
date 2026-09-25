/**
 * Group A for the Anthropic Messages API: how the endpoint's errors, headers
 * and validation compare with what Anthropic documents, and - in the four
 * matrices - which request shapes it refuses for the claimed model.
 */

import type { Probe } from '../../types.js'
import { assistantPrefill } from './assistant-prefill.js'
import { betaHeader } from './beta-header.js'
import { errorEnvelope } from './error-envelope.js'
import { errorVocabulary } from './error-vocabulary.js'
import { extraInputs } from './extra-inputs.js'
import { forcedToolChoice } from './forced-tool-choice.js'
import { missingMaxTokens } from './missing-max-tokens.js'
import { modelRetrieve } from './model-retrieve.js'
import { samplingMatrix } from './sampling-matrix.js'
import { thinkingMatrix } from './thinking-matrix.js'

export const ANTHROPIC_CONFORMANCE_PROBES: readonly Probe[] = Object.freeze([
  errorEnvelope,
  errorVocabulary,
  extraInputs,
  betaHeader,
  missingMaxTokens,
  modelRetrieve,
  samplingMatrix,
  assistantPrefill,
  thinkingMatrix,
  forcedToolChoice,
])
