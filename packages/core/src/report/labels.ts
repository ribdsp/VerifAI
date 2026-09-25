/**
 * The words every renderer uses for the report's closed sets.
 *
 * One table per vocabulary, typed as a full `Record`, so a finding added to an
 * axis is a type error here until it has words - rather than a renderer that
 * prints `undefined` beside a verdict. None of them alleges intent: they say
 * what the endpoint behaved like, never what its operator meant.
 */

import type { AuthScheme } from '../adapters/types.js'
import type { SkipReason } from '../runner/types.js'
import type {
  ConsistencyFinding,
  EvidenceFinding,
  IdentityFinding,
  PlatformFinding,
  TranslationFinding,
  Verdict,
} from '../types/assessment.js'
import type { Vendor } from '../types/target.js'
import type { CeilingReason } from './types.js'

export const VENDOR_NAMES: Readonly<Record<Vendor, string>> = Object.freeze({
  anthropic: 'Anthropic',
  openai: 'OpenAI',
})

export const AUTH_TEXT: Readonly<Record<AuthScheme, string>> = Object.freeze({
  'x-api-key': 'x-api-key header',
  bearer: 'bearer token (Authorization header)',
})

export const HEADLINE_LABELS: Readonly<Record<Verdict, string>> = Object.freeze({
  pass: 'PASS',
  caution: 'CAUTION',
  fail: 'FAIL',
})

export const IDENTITY_TEXT: Readonly<Record<IdentityFinding, string>> = Object.freeze({
  'matches-claim': 'behaves like the claimed model',
  'same-vendor-cheaper': 'a cheaper or older model from the same vendor',
  'different-vendor': 'a model from another vendor',
  'not-a-live-model': 'canned or replayed answers, not a live model',
  unknown: 'not established by the probes that ran',
})

export const CONSISTENCY_TEXT: Readonly<Record<ConsistencyFinding, string>> = Object.freeze({
  uniform: 'repeated identical checks agreed',
  fractional: 'repeated identical checks disagreed: a mixture',
  unknown: 'too few repeated checks to tell',
})

export const PLATFORM_TEXT: Readonly<Record<PlatformFinding, string>> = Object.freeze({
  'first-party': "the vendor's own API, or a faithful pass-through",
  'partner-cloud': 'a cloud partner of the vendor (legitimate)',
  unknown: 'not established',
})

export const TRANSLATION_TEXT: Readonly<Record<TranslationFinding, string>> = Object.freeze({
  direct: "reached over the vendor's own protocol",
  translated: 'a protocol translation layer is in the path (not fraud)',
  unknown: 'not established',
})

export const EVIDENCE_TEXT: Readonly<Record<EvidenceFinding, string>> = Object.freeze({
  sufficient: 'the planned probes ran and answered',
  'budget-limited': 'probes were left out to stay inside the budget',
  obstructed: 'the endpoint refused or failed probes it should answer',
})

export const CEILING_REASON_TEXT: Readonly<Record<CeilingReason, string>> = Object.freeze({
  'groups-b-c-not-run': 'the accounting and tokenizer probes did not run',
  'group-b-not-run': 'the accounting probes did not run',
  'group-c-not-run': 'the tokenizer probes did not run',
  'group-d-not-run': 'the causal capability probes did not run',
  'cross-protocol': "the model is served over the other vendor's protocol",
  'probes-skipped': 'some probes that applied were skipped',
  'calibration-documented-only': 'no signal rests on recorded ground truth yet',
})

export const SKIP_REASON_TEXT: Readonly<Record<SkipReason, string>> = Object.freeze({
  'not-applicable': 'does not apply to this protocol, vendor or model',
  'needs-api-key': 'needs an API key',
  'budget-exceeded': 'would have passed the request or token budget',
  'endpoint-error': 'the endpoint failed or refused it',
  'unsupported-by-transport': 'the transport cannot open a fresh connection per request',
  blocked: "the endpoint's address was refused",
  'opt-in': 'runs only when asked for',
  aborted: 'the run was cancelled first',
  profile: 'not part of the chosen profile',
  'probe-error': 'the probe itself failed (a VerifAI bug, not a finding)',
})

/** Printed under every rendered report. */
export const DISCLAIMER =
  'VerifAI reports what the endpoint did and what the vendor documents. It states facts, not intent, and a software check cannot prove which model is behind an API.'
