/** The conformance probes that read both vendors' documents, in the order a run reports them. */

import type { Probe } from '../../types.js'
import { compatFields } from './compat-fields.js'
import { permissiveValidator } from './permissive-validator.js'
import { protocolLeakage } from './protocol-leakage.js'

export const COMMON_CONFORMANCE_PROBES: readonly Probe[] = Object.freeze([
  permissiveValidator,
  protocolLeakage,
  compatFields,
])
