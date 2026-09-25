import { describe, expect, it } from 'vitest'
import { isEstimate, isOptions, isRunEvent, looksLikeReport } from '../src/lib/guards'
import { CREATED, OPTIONS, REPORT } from './fixtures'

describe('looksLikeReport', () => {
  it('accepts a report as core types it', () => {
    expect(looksLikeReport(REPORT)).toBe(true)
    expect(looksLikeReport({ ...REPORT, verdict: { ...REPORT.verdict, epsilon: null } })).toBe(true)
  })

  it.each([
    ['null', null],
    ['an array', [REPORT]],
    ['another report version', { ...REPORT, reportVersion: 2 }],
    ['no signals', { ...REPORT, signals: undefined }],
    ['an unknown headline', { ...REPORT, verdict: { ...REPORT.verdict, headline: 'maybe' } }],
    [
      'a confidence that is not a number',
      { ...REPORT, verdict: { ...REPORT.verdict, confidence: 'high' } },
    ],
    [
      'a one-sided epsilon interval',
      {
        ...REPORT,
        verdict: {
          ...REPORT.verdict,
          epsilon: { ...REPORT.verdict.epsilon, interval: [0.1] },
        },
      },
    ],
    ['a posterior that is not a number', { ...REPORT, posteriors: { identity: { unknown: '1' } } }],
    [
      'a signal without citations',
      { ...REPORT, signals: [{ ...REPORT.signals[0], citations: undefined }] },
    ],
    ['no endpoint hash', { ...REPORT, target: { ...REPORT.target, endpointHash: 7 } }],
  ])('rejects %s', (_name, value) => {
    expect(looksLikeReport(value)).toBe(false)
  })
})

describe('isEstimate and isOptions', () => {
  it('accept the contract shapes', () => {
    expect(isEstimate(CREATED.estimate)).toBe(true)
    expect(isOptions(OPTIONS)).toBe(true)
  })

  it('reject a wrong vocabulary member, a bad count or an empty profile list', () => {
    expect(isEstimate({ ...CREATED.estimate, protocol: 'grpc' })).toBe(false)
    expect(isEstimate({ ...CREATED.estimate, requests: -1 })).toBe(false)
    expect(isEstimate({ ...CREATED.estimate, auth: 'basic' })).toBe(false)
    expect(isEstimate({ ...CREATED.estimate, probes: [{ id: 'A1', group: 'Z' }] })).toBe(false)
    expect(isOptions({ ...OPTIONS, profiles: [] })).toBe(false)
    expect(isOptions({ ...OPTIONS, limits: undefined })).toBe(false)
    expect(isOptions({ ...OPTIONS, vendors: ['auto', 'mistral'] })).toBe(false)
    expect(isOptions({ ...OPTIONS, authChoices: ['auto', 'basic'] })).toBe(false)
    expect(isOptions({ ...OPTIONS, defaults: { ...OPTIONS.defaults, auth: 'basic' } })).toBe(false)
  })
})

describe('isRunEvent', () => {
  it('knows draws and probe events', () => {
    expect(isRunEvent({ kind: 'draw', draw: 1, outcome: 'agree' })).toBe(true)
    expect(isRunEvent({ kind: 'request', probeId: 'A1', status: null, tokens: 0 })).toBe(true)
    expect(isRunEvent({ kind: 'draw-taken', draw: 3 })).toBe(true)
  })

  it('refuses unknown kinds, bad draws and probe events without a probe', () => {
    expect(isRunEvent({ kind: 'telemetry', probeId: 'A1' })).toBe(false)
    expect(isRunEvent({ kind: 'draw', draw: 1, outcome: 'maybe' })).toBe(false)
    expect(isRunEvent({ kind: 'draw-taken', draw: -1 })).toBe(false)
    expect(isRunEvent({ kind: 'draw-taken', draw: '3' })).toBe(false)
    expect(isRunEvent({ kind: 'request', probeId: 'A1', status: 200 })).toBe(false)
    expect(isRunEvent({ kind: 'request', probeId: 'A1', status: 200, tokens: -5 })).toBe(false)
    expect(isRunEvent({ kind: 'request', probeId: 'A1', status: '200', tokens: 0 })).toBe(false)
    expect(isRunEvent({ kind: 'waiting', waitMs: 10 })).toBe(false)
    expect(isRunEvent('draw')).toBe(false)
  })
})
