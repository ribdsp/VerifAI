/**
 * Group B: what a response says about itself - its token counts, its
 * limits, its IDs and the model it names - against what the vendor's own API
 * reports.
 */

import type { Probe } from '../types.js'
import { countTokensAgreement } from './count-tokens-agreement.js'
import { hiddenInput } from './hidden-input.js'
import { idFormat } from './id-format.js'
import { outputLimit } from './output-limit.js'
import { snapshotEcho } from './snapshot-echo.js'
import { systemFingerprint } from './system-fingerprint.js'
import { usageArithmetic } from './usage-arithmetic.js'

export const ACCOUNTING_PROBES: readonly Probe[] = Object.freeze([
  usageArithmetic,
  outputLimit,
  idFormat,
  snapshotEcho,
  systemFingerprint,
  countTokensAgreement,
  hiddenInput,
])
