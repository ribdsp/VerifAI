/**
 * Words for every code the daemon sends: warnings, skip reasons, ceiling
 * reasons, findings and verdicts. A code this build does not know is shown
 * as itself rather than dropped, so a newer daemon never loses information.
 *
 * The texts state facts. None of them alleges intent; the report format
 * forbids that of every renderer.
 */

import type {
  Assessment,
  AuthChoice,
  Calibration,
  CeilingReason,
  Epsilon,
  EstimateWarning,
  EstimateWarningText,
  Pairing,
  ProbeGroup,
  ProtocolChoice,
  SignalFamily,
  SkipReason,
  VendorChoice,
  Verdict,
} from '@verifai/core'
import { ESTIMATE_WARNING_TEXT } from '@verifai/core'

export type WarningText = EstimateWarningText

export const WARNING_TEXT = ESTIMATE_WARNING_TEXT

export function warningText(code: string): WarningText {
  return (
    WARNING_TEXT[code as EstimateWarning] ?? {
      title: code,
      text: 'No description.',
      prominent: false,
    }
  )
}

export const SKIP_REASON_TEXT: Readonly<Record<SkipReason, string>> = Object.freeze({
  'not-applicable': 'Does not apply to this protocol, vendor or model.',
  'needs-api-key': 'Needs an API key, and this run has none.',
  'budget-exceeded': 'Would exceed the request or token budget.',
  'endpoint-error': 'The endpoint answered with an error.',
  'unsupported-by-transport': 'This transport cannot send what the probe needs.',
  blocked: 'The endpoint’s address was refused by the target policy.',
  'opt-in': 'Runs only when asked for explicitly.',
  aborted: 'The run stopped before this probe finished.',
  profile: 'Not part of the selected profile.',
  'probe-error': 'The probe failed inside VerifAI.',
})

export function skipReasonText(reason: string): string {
  return SKIP_REASON_TEXT[reason as SkipReason] ?? reason
}

export const CEILING_REASON_TEXT: Readonly<Record<CeilingReason, string>> = Object.freeze({
  'groups-b-c-not-run': 'Neither accounting (B) nor tokenizer (C) probes ran.',
  'group-b-not-run': 'The accounting probes (Group B) did not run.',
  'group-c-not-run': 'The tokenizer probes (Group C) did not run.',
  'group-d-not-run': 'The causal capability probes (Group D) did not run.',
  'cross-protocol': 'The model is served over the other vendor’s protocol.',
  'probes-skipped': 'Some planned probes were skipped.',
  'calibration-documented-only':
    'The evidence rests on documented behaviour only, with no measured calibration.',
})

export function ceilingReasonText(reason: string): string {
  return CEILING_REASON_TEXT[reason as CeilingReason] ?? reason
}

// biome-ignore-start lint/style/useNamingConvention: core's probe group letters.
export const GROUP_NAMES: Readonly<Record<ProbeGroup, string>> = Object.freeze({
  A: 'Protocol conformance',
  B: 'Accounting and identity integrity',
  C: 'Tokenizer forensics',
  D: 'Causal capability',
  E: 'Behaviour and cross-model consistency',
  F: 'Routing dilution',
})
// biome-ignore-end lint/style/useNamingConvention: core's probe group letters.

export interface VerdictDisplay {
  readonly label: string
  /** A text glyph, so the verdict never rests on colour alone. */
  readonly glyph: string
  readonly summary: string
}

export const VERDICT_DISPLAY: Readonly<Record<Verdict, VerdictDisplay>> = Object.freeze({
  pass: {
    label: 'Pass',
    glyph: '✓',
    summary: 'Behaves like the advertised model, with enough evidence to say so.',
  },
  caution: {
    label: 'Caution',
    glyph: '!',
    summary: 'Something is unresolved. This is not reassurance: read the axes below.',
  },
  fail: {
    label: 'Fail',
    glyph: '✕',
    summary: 'An adverse finding, held to a higher evidential bar than a pass.',
  },
})

export interface AxisDescription<F extends string> {
  readonly axis: string
  readonly question: string
  readonly findings: Readonly<Record<F, string>>
}

export type AxisKey = keyof Assessment

export const AXES: { readonly [K in AxisKey]: AxisDescription<Assessment[K]> } = Object.freeze({
  identity: {
    axis: 'Identity',
    question: 'Which model is actually answering?',
    findings: {
      'matches-claim': 'Matches the claim',
      'same-vendor-cheaper': 'Same vendor, cheaper model',
      'different-vendor': 'Different vendor',
      'not-a-live-model': 'Not a live model',
      unknown: 'Not established',
    },
  },
  consistency: {
    axis: 'Consistency',
    question: 'Does that hold for every request?',
    findings: {
      uniform: 'Uniform',
      fractional: 'Fractional routing',
      unknown: 'Not established',
    },
  },
  platform: {
    axis: 'Platform',
    question: 'Whose infrastructure serves it?',
    findings: {
      'first-party': 'First-party',
      'partner-cloud': 'Partner cloud',
      unknown: 'Not established',
    },
  },
  translation: {
    axis: 'Translation',
    question: 'Is a protocol translation layer in the path?',
    findings: {
      direct: 'Direct',
      translated: 'Translated (not fraud)',
      unknown: 'Not established',
    },
  },
  evidence: {
    axis: 'Evidence',
    question: 'How much did the run establish?',
    findings: {
      sufficient: 'Sufficient',
      'budget-limited': 'Budget-limited',
      obstructed: 'Obstructed',
    },
  },
})

export const AXIS_KEYS: readonly AxisKey[] = Object.freeze([
  'identity',
  'consistency',
  'platform',
  'translation',
  'evidence',
])

export function findingLabel(axis: AxisKey, finding: string): string {
  const findings: Readonly<Record<string, string>> = AXES[axis].findings
  return findings[finding] ?? finding
}

export const VENDOR_LABELS: Readonly<Record<VendorChoice, string>> = Object.freeze({
  auto: 'Auto (from the model name)',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
})

export const PROTOCOL_LABELS: Readonly<Record<ProtocolChoice, string>> = Object.freeze({
  auto: 'Auto (detect from the endpoint)',
  'anthropic-messages': 'Anthropic Messages',
  'openai-chat': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
})

export const AUTH_LABELS: Readonly<Record<AuthChoice, string>> = Object.freeze({
  auto: 'Auto (as the protocol’s vendor documents)',
  'x-api-key': 'x-api-key header',
  bearer: 'Bearer token (Snowflake Cortex)',
})

export const PAIRING_LABELS: Readonly<Record<Pairing, string>> = Object.freeze({
  native: 'Native: the vendor’s own protocol',
  'cross-protocol': 'Cross-protocol: the other vendor’s protocol',
})

/** A label from one of the maps above, or the code itself. */
export function labelOf(labels: Readonly<Record<string, string>>, code: string): string {
  return labels[code] ?? code
}

export const FAMILY_NAMES: Readonly<Record<SignalFamily, string>> = Object.freeze({
  'protocol-conformance': 'Protocol conformance',
  accounting: 'Accounting and identity',
  tokenizer: 'Tokenizer',
  'causal-capability': 'Causal capability',
  behavioral: 'Behaviour',
})

/** How much weight a signal's expectation can bear, strongest first. */
export const CALIBRATION_TEXT: Readonly<Record<Calibration, string>> = Object.freeze({
  measured: 'Measured: this project published the measurement.',
  documented: 'Documented: the vendor’s own documentation says so.',
  derived: 'Derived: follows from documented behaviour.',
  heuristic: 'Heuristic: a rule of thumb, weighted least.',
})

/** How a routing-dilution draw was judged. `DilutionBasis` is not exported by core. */
export const BASIS_TEXT: Readonly<Record<Epsilon['basis'], string>> = Object.freeze({
  reference: 'Each draw was judged against the answer the claimed model is known to give.',
  mode: 'Each draw was judged against the most common answer in this run.',
})
