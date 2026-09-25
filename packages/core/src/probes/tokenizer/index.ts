/**
 * Group C: how the endpoint's reported input counts split text, against
 * OpenAI's public encodings computed on the buyer's machine.
 */

import type { Probe } from '../types.js'
import { anthropicDifferential } from './anthropic-differential.js'
import { openaiLocalCount } from './openai-local-count.js'

export const TOKENIZER_PROBES: readonly Probe[] = Object.freeze([
  openaiLocalCount,
  anthropicDifferential,
])
