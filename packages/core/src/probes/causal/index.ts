/**
 * Group D: capabilities only the claimed backend has as documented - thinking
 * signatures it verifies, a cache that starts at its own minimum and matches
 * exact prefixes, a schema it enforces while decoding, tokens chosen by ID in
 * its own encoding.
 */

import type { Probe } from '../types.js'
import { cacheInvalidation } from './cache-invalidation.js'
import { cacheThreshold } from './cache-threshold.js'
import { logitBias } from './logit-bias.js'
import { logprobsRetokenize } from './logprobs-retokenize.js'
import { structuredOutput } from './structured-output.js'
import { thinkingDisplay } from './thinking-display.js'
import { thinkingSignature } from './thinking-signature.js'

export const CAUSAL_PROBES: readonly Probe[] = Object.freeze([
  thinkingSignature,
  thinkingDisplay,
  cacheThreshold,
  cacheInvalidation,
  structuredOutput,
  logitBias,
  logprobsRetokenize,
])
