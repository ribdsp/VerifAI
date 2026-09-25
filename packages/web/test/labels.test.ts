import {
  AUTH_CHOICES,
  CALIBRATIONS,
  CEILING_REASONS,
  CONSISTENCY_FINDINGS,
  ESTIMATE_WARNINGS,
  EVIDENCE_FINDINGS,
  IDENTITY_FINDINGS,
  PAIRINGS,
  PLATFORM_FINDINGS,
  PROBE_GROUPS,
  PROTOCOL_CHOICES,
  SIGNAL_FAMILIES,
  SKIP_REASONS,
  TRANSLATION_FINDINGS,
  VENDOR_CHOICES,
  VERDICTS,
} from '@verifai/core'
import { describe, expect, it } from 'vitest'
import {
  AUTH_LABELS,
  AXES,
  AXIS_KEYS,
  CALIBRATION_TEXT,
  CEILING_REASON_TEXT,
  ceilingReasonText,
  FAMILY_NAMES,
  findingLabel,
  GROUP_NAMES,
  labelOf,
  PAIRING_LABELS,
  PROTOCOL_LABELS,
  SKIP_REASON_TEXT,
  skipReasonText,
  VENDOR_LABELS,
  VERDICT_DISPLAY,
  WARNING_TEXT,
  warningText,
} from '../src/lib/labels'

const sorted = (values: Iterable<string>) => [...values].sort()

describe('every core code has a label', () => {
  it.each([
    ['estimate warnings', WARNING_TEXT, ESTIMATE_WARNINGS.values],
    ['skip reasons', SKIP_REASON_TEXT, SKIP_REASONS.values],
    ['ceiling reasons', CEILING_REASON_TEXT, CEILING_REASONS.values],
    ['probe groups', GROUP_NAMES, PROBE_GROUPS.values],
    ['signal families', FAMILY_NAMES, SIGNAL_FAMILIES.values],
    ['calibrations', CALIBRATION_TEXT, CALIBRATIONS.values],
    ['vendors', VENDOR_LABELS, VENDOR_CHOICES.values],
    ['protocols', PROTOCOL_LABELS, PROTOCOL_CHOICES.values],
    ['key headers', AUTH_LABELS, AUTH_CHOICES.values],
    ['pairings', PAIRING_LABELS, PAIRINGS.values],
    ['verdicts', VERDICT_DISPLAY, VERDICTS.values],
  ] as const)('%s', (_name, labels, codes) => {
    expect(sorted(Object.keys(labels))).toEqual(sorted(codes))
  })

  it.each([
    ['identity', IDENTITY_FINDINGS.values],
    ['consistency', CONSISTENCY_FINDINGS.values],
    ['platform', PLATFORM_FINDINGS.values],
    ['translation', TRANSLATION_FINDINGS.values],
    ['evidence', EVIDENCE_FINDINGS.values],
  ] as const)('%s findings', (axis, findings) => {
    expect(sorted(Object.keys(AXES[axis].findings))).toEqual(sorted(findings))
  })

  it('lists all five axes once', () => {
    expect(sorted(AXIS_KEYS)).toEqual(sorted(Object.keys(AXES)))
  })

  it('marks every verdict with a glyph, so colour is never the only signal', () => {
    for (const display of Object.values(VERDICT_DISPLAY)) {
      expect(display.glyph).not.toBe('')
      expect(display.label).not.toBe('')
    }
  })
})

describe('unknown codes fall back to the code itself', () => {
  it('for warnings', () => {
    expect(warningText('new-warning')).toEqual({
      title: 'new-warning',
      text: 'No description.',
      prominent: false,
    })
    expect(warningText('plain-http').prominent).toBe(true)
  })

  it('for reasons, labels and findings', () => {
    expect(skipReasonText('new-reason')).toBe('new-reason')
    expect(ceilingReasonText('new-reason')).toBe('new-reason')
    expect(labelOf(VENDOR_LABELS, 'mistral')).toBe('mistral')
    expect(labelOf(VENDOR_LABELS, 'openai')).toBe('OpenAI')
    expect(findingLabel('identity', 'new-finding')).toBe('new-finding')
    expect(findingLabel('identity', 'matches-claim')).toBe('Matches the claim')
  })
})
