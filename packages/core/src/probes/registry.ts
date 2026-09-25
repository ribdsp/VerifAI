/**
 * Every probe VerifAI has, in the priority order the planner admits them.
 *
 * Cheapest and most telling first: conformance costs nothing and catches the
 * naive proxy, accounting and tokenizer forensics come next, the causal probes
 * after them, and Group F last because it repeats. Within a group the order is
 * the group's own index. A probe that does not apply to a run is dropped by the
 * planner, so the list carries every protocol and vendor at once.
 */

import { ACCOUNTING_PROBES } from './accounting/index.js'
import { CAUSAL_PROBES } from './causal/index.js'
import { ANTHROPIC_CONFORMANCE_PROBES } from './conformance/anthropic/index.js'
import { COMMON_CONFORMANCE_PROBES } from './conformance/common/index.js'
import { OPENAI_CONFORMANCE_PROBES } from './conformance/openai/index.js'
import { DILUTION_PROBES } from './dilution/index.js'
import { TOKENIZER_PROBES } from './tokenizer/index.js'
import type { AnyProbe } from './types.js'

export const PROBE_CATALOGUE: readonly AnyProbe[] = Object.freeze([
  ...OPENAI_CONFORMANCE_PROBES,
  ...ANTHROPIC_CONFORMANCE_PROBES,
  ...COMMON_CONFORMANCE_PROBES,
  ...ACCOUNTING_PROBES,
  ...TOKENIZER_PROBES,
  ...CAUSAL_PROBES,
  ...DILUTION_PROBES,
])
