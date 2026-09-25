/**
 * Shape checks for what the daemon sends back.
 *
 * The daemon is ours and its responses are typed rather than re-validated on
 * its side, so these stay minimal: enough that a truncated body, a proxy's
 * HTML error page or a daemon from another version fails as one typed client
 * error instead of as a `TypeError` deep inside a component.
 */

import {
  AUTH_CHOICES,
  AUTH_SCHEMES,
  type CheckEstimate,
  DRAW_OUTCOMES,
  type OptionsResponse,
  PAIRINGS,
  PROBE_GROUPS,
  PROFILES,
  PROTOCOL_CHOICES,
  PROTOCOLS,
  REPORT_VERSION,
  type Report,
  type RunEvent,
  VENDOR_CHOICES,
  VENDORS,
  VERDICTS,
} from '@verifai/core'

export type Json = Readonly<Record<string, unknown>>

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

export function isListOf(value: unknown, test: (entry: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.every((entry) => test(entry))
}

export function hasCounts(value: unknown, keys: readonly string[]): boolean {
  return isRecord(value) && keys.every((key) => isCount(value[key]))
}

export function isPlannedProbe(value: unknown): boolean {
  return (
    isRecord(value) && isString(value.id) && isString(value.title) && PROBE_GROUPS.has(value.group)
  )
}

export function isSkippedProbe(value: unknown): boolean {
  return isRecord(value) && isString(value.probeId) && isString(value.reason)
}

export function isEstimate(value: unknown): value is CheckEstimate {
  return (
    isRecord(value) &&
    PROTOCOLS.has(value.protocol) &&
    VENDORS.has(value.vendor) &&
    PAIRINGS.has(value.pairing) &&
    AUTH_SCHEMES.has(value.auth) &&
    PROFILES.has(value.profile) &&
    hasCounts(value, ['requests', 'tokens', 'maxRequests', 'maxTokens']) &&
    isListOf(value.probes, isPlannedProbe) &&
    isListOf(value.skipped, isSkippedProbe) &&
    isListOf(value.warnings, isString)
  )
}

function isProfileOption(value: unknown): boolean {
  return (
    isRecord(value) &&
    PROFILES.has(value.profile) &&
    isString(value.description) &&
    isListOf(value.groups, PROBE_GROUPS.has) &&
    hasCounts(value, ['draws', 'spreadMs', 'maxRequests', 'maxTokens'])
  )
}

export function isOptions(value: unknown): value is OptionsResponse {
  if (!(isRecord(value) && isRecord(value.defaults) && isRecord(value.limits))) {
    return false
  }
  const { defaults, limits } = value
  return (
    isString(value.version) &&
    isListOf(value.profiles, isProfileOption) &&
    value.profiles.length > 0 &&
    isListOf(value.vendors, VENDOR_CHOICES.has) &&
    isListOf(value.protocols, PROTOCOL_CHOICES.has) &&
    isListOf(value.authChoices, AUTH_CHOICES.has) &&
    PROFILES.has(defaults.profile) &&
    VENDOR_CHOICES.has(defaults.vendor) &&
    PROTOCOL_CHOICES.has(defaults.protocol) &&
    AUTH_CHOICES.has(defaults.auth) &&
    hasCounts(limits, [
      'maxRequests',
      'maxTokens',
      'maxSpreadMs',
      'maxEndpointLength',
      'maxModelLength',
    ])
  )
}

const PROBE_EVENT_KINDS: ReadonlySet<string> = new Set([
  'probe-started',
  'probe-finished',
  'request',
  'waiting',
  'probe-error',
])

/** An event of a kind this page knows how to show. */
export function isRunEvent(value: unknown): value is RunEvent {
  if (!(isRecord(value) && isString(value.kind))) {
    return false
  }
  if (value.kind === 'draw') {
    return isDrawRecord(value)
  }
  return PROBE_EVENT_KINDS.has(value.kind) && isString(value.probeId)
}

function isCitation(value: unknown): boolean {
  return (
    isRecord(value) && isString(value.url) && isString(value.quote) && isString(value.retrievedAt)
  )
}

export function isSignal(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['probeId', 'signalId', 'family', 'calibration', 'observed', 'expected', 'plainLanguage'].every(
      (key) => isString(value[key]),
    ) &&
    isListOf(value.citations, isCitation)
  )
}

function isDrawRecord(value: unknown): boolean {
  return isRecord(value) && isCount(value.draw) && DRAW_OUTCOMES.has(value.outcome)
}

export function isEpsilon(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.probeId) &&
    isString(value.basis) &&
    hasCounts(value, ['disagreements', 'trials', 'lost']) &&
    (value.estimate === null || isNumber(value.estimate)) &&
    isListOf(value.interval, isNumber) &&
    value.interval.length === 2 &&
    typeof value.clustered === 'boolean' &&
    isListOf(value.draws, isDrawRecord)
  )
}

function isDistribution(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isNumber)
}

function isVerdictBlock(value: unknown): boolean {
  return (
    isRecord(value) &&
    VERDICTS.has(value.headline) &&
    isRecord(value.assessment) &&
    isNumber(value.confidence) &&
    isNumber(value.confidenceCeiling) &&
    isListOf(value.ceilingReasons, isString) &&
    isString(value.plainLanguage) &&
    (value.epsilon === null || isEpsilon(value.epsilon))
  )
}

/**
 * The parts of a report every view reads before anything else. A report that
 * passes this and is still wrong deeper down is caught by the view's error
 * boundary instead.
 */
export function looksLikeReport(value: unknown): value is Report {
  return (
    isRecord(value) &&
    value.reportVersion === REPORT_VERSION &&
    isRecord(value.tool) &&
    isRecord(value.run) &&
    isRecord(value.target) &&
    isString(value.target.endpointHash) &&
    isVerdictBlock(value.verdict) &&
    isRecord(value.posteriors) &&
    Object.values(value.posteriors).every(isDistribution) &&
    isListOf(value.signals, isSignal) &&
    isListOf(value.skipped, isSkippedProbe) &&
    Array.isArray(value.evidence)
  )
}
