import type { Signal } from '@verifai/core'
import { describe, expect, it } from 'vitest'
import {
  describeEvent,
  describeProblem,
  drawCounts,
  formatCount,
  formatDuration,
  formatInterval,
  formatPercent,
  formatProbability,
  groupProbes,
  groupSignals,
  groupSkipped,
  plural,
  safeHttpsUrl,
  shareOf,
  shortHash,
} from '../src/lib/format'
import { SIGNAL } from './fixtures'

describe('number formatting', () => {
  it('formats counts, shares, intervals and probabilities as given', () => {
    expect(formatCount(1_234_567)).toBe('1,234,567')
    expect(formatPercent(0.1234)).toBe('12.3%')
    expect(formatPercent(0.5, 0)).toBe('50%')
    expect(formatInterval([0.002, 0.19])).toBe('0.2% – 19.0%')
    expect(formatProbability(0.91)).toBe('0.910')
  })

  it('formats durations at a scale a reader takes in at once', () => {
    expect(formatDuration(-5)).toBe('0 ms')
    expect(formatDuration(250)).toBe('250 ms')
    expect(formatDuration(12_400)).toBe('12 s')
    expect(formatDuration(120_000)).toBe('2 min')
    expect(formatDuration(150_000)).toBe('2 min 30 s')
    expect(formatDuration(3_600_000)).toBe('1 h')
    expect(formatDuration(5_400_000)).toBe('1 h 30 min')
  })

  it('keeps a bar share within [0, 1]', () => {
    expect(shareOf(50, 200)).toBe(0.25)
    expect(shareOf(500, 200)).toBe(1)
    expect(shareOf(-1, 200)).toBe(0)
    expect(shareOf(5, 0)).toBe(0)
    expect(shareOf(Number.NaN, 10)).toBe(0)
  })

  it('pluralises and words schema bounds', () => {
    expect(plural(1, 'probe')).toBe('1 probe')
    expect(plural(2000, 'probe')).toBe('2,000 probes')
    expect(describeProblem('maxRequests: expected <=2000')).toBe(
      'maxRequests: expected at most 2,000',
    )
    expect(describeProblem('endpoint: expected >=1')).toBe('endpoint: expected at least 1')
  })

  it('shortens a hash for a label', () => {
    expect(shortHash(`sha256:${'ab'.repeat(32)}`)).toBe('abababababab…')
    expect(shortHash('abc')).toBe('abc')
  })
})

describe('safeHttpsUrl', () => {
  it('passes an absolute https URL', () => {
    expect(safeHttpsUrl('https://docs.example.com/a?b=1#c')).toBe(
      'https://docs.example.com/a?b=1#c',
    )
  })

  it.each([
    'http://docs.example.com/',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//docs.example.com/',
    '/relative/path',
    'https://user:secret@docs.example.com/',
    'not a url',
    '',
  ])('refuses %j', (url) => {
    expect(safeHttpsUrl(url)).toBeUndefined()
  })
})

describe('grouping', () => {
  it('groups planned probes A to F and leaves out empty groups', () => {
    const rows = groupProbes([
      { id: 'F1', title: 'Draws', group: 'F' },
      { id: 'A2', title: 'Errors', group: 'A' },
      { id: 'A1', title: 'Envelope', group: 'A' },
    ])

    expect(rows.map((row) => [row.group, row.probes.map((probe) => probe.id)])).toEqual([
      ['A', ['A2', 'A1']],
      ['F', ['F1']],
    ])
    expect(rows[0]?.name).toBe('Protocol conformance')
  })

  it('groups skipped probes by reason, in first-seen order', () => {
    const rows = groupSkipped([
      { probeId: 'D1', reason: 'profile' },
      { probeId: 'B2', reason: 'needs-api-key' },
      { probeId: 'D3', reason: 'profile' },
    ])

    expect(rows).toEqual([
      { reason: 'profile', text: 'Not part of the selected profile.', probeIds: ['D1', 'D3'] },
      {
        reason: 'needs-api-key',
        text: 'Needs an API key, and this run has none.',
        probeIds: ['B2'],
      },
    ])
  })

  it('groups signals in core family order, then families this build does not know', () => {
    const unknown = { ...SIGNAL, signalId: 'x', family: 'telepathy' } as unknown as Signal
    const tokenizer: Signal = { ...SIGNAL, signalId: 't', family: 'tokenizer' }

    const groups = groupSignals([unknown, tokenizer, SIGNAL])

    expect(groups.map((group) => [group.family, group.name, group.signals.length])).toEqual([
      ['protocol-conformance', 'Protocol conformance', 1],
      ['tokenizer', 'Tokenizer', 1],
      ['telepathy', 'telepathy', 1],
    ])
  })

  it('counts draws by outcome', () => {
    expect(
      drawCounts([
        { draw: 1, outcome: 'agree' },
        { draw: 2, outcome: 'agree' },
        { draw: 3, outcome: 'disagree' },
        { draw: 4, outcome: 'excluded' },
      ]),
    ).toEqual({ agree: 2, disagree: 1, lost: 0, excluded: 1 })
  })
})

describe('describeEvent', () => {
  it('describes each kind of event with a tone', () => {
    expect(describeEvent({ kind: 'probe-started', probeId: 'A1', index: 0, total: 12 })).toEqual({
      tone: 'info',
      text: 'A1 started (1 of 12)',
    })
    expect(
      describeEvent({ kind: 'probe-finished', probeId: 'A1', status: 'ran', signals: 1 }),
    ).toEqual({ tone: 'ok', text: 'A1 finished, 1 signal' })
    expect(
      describeEvent({
        kind: 'probe-finished',
        probeId: 'B1',
        status: 'skipped',
        reason: 'budget-exceeded',
        signals: 0,
      }),
    ).toEqual({ tone: 'warn', text: 'B1 skipped: Would exceed the request or token budget.' })
    expect(describeEvent({ kind: 'waiting', probeId: 'F1', waitMs: 1500 })).toEqual({
      tone: 'info',
      text: 'F1 waiting 2 s',
    })
    expect(describeEvent({ kind: 'draw', draw: 3, outcome: 'disagree' })).toEqual({
      tone: 'bad',
      text: 'Draw 3: disagree',
    })
    expect(describeEvent({ kind: 'probe-error', probeId: 'C1', message: 'Timed out.' })).toEqual({
      tone: 'bad',
      text: 'C1 error: Timed out.',
    })
  })

  it('tones a request by its status', () => {
    const tone = (status: number | null) =>
      describeEvent({ kind: 'request', probeId: 'A1', status }).tone

    expect(tone(200)).toBe('info')
    expect(tone(429)).toBe('warn')
    expect(tone(503)).toBe('bad')
    expect(tone(null)).toBe('bad')
    expect(describeEvent({ kind: 'request', probeId: 'A1', status: null }).text).toBe(
      'A1 no response',
    )
  })
})
