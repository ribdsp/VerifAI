import { describe, expect, it } from 'vitest'
import { buildReport, endpointHash, type ReportInput } from '../src/report/build.js'
import { DISCLAIMER } from '../src/report/labels.js'
import { plainLanguageFor } from '../src/report/plain-language.js'
import { renderJson } from '../src/report/render-json.js'
import { markdownText, renderMarkdown } from '../src/report/render-markdown.js'
import { renderTerminal, type TerminalStyle } from '../src/report/render-terminal.js'
import {
  epsilonSummary,
  evidenceSummary,
  footnotesOf,
  plainText,
  stanceOf,
  weightOf,
} from '../src/report/text.js'
import type { Report } from '../src/report/types.js'
import type { EvidenceEntry, RunResult } from '../src/runner/types.js'
import { assess } from '../src/scoring/assess.js'
import { epsilonOf } from '../src/scoring/dispersion.js'
import type { Assessment } from '../src/types/assessment.js'
import { probeTarget } from './fakes/context.js'
import { draws, ran, signal } from './support/scoring.js'

const KEY = ['sk', 'ant', 'api03', 'Zq7tXv9kLm2Np4Rs6Tu8Wy0Ab3Cd5Ef7Gh'].join('-')

function evidence(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    probeId: 'test/probe',
    requestDigest: `sha256:${'a'.repeat(64)}`,
    responseDigest: `sha256:${'b'.repeat(64)}`,
    status: 200,
    sentAtMs: 10,
    timing: { ttftMs: 5, totalMs: 20, tokensPerSecond: null },
    connection: 'fresh',
    ...overrides,
  }
}

function result(overrides: Partial<RunResult> = {}): RunResult {
  return {
    signals: [signal({ llr: { identity: { 'matches-claim': 0.3 } } })],
    skipped: [{ probeId: 'test/skipped', reason: 'budget-exceeded' }],
    evidence: [evidence()],
    outcomes: [...ran('A')],
    dilution: undefined,
    aborted: false,
    requests: 1,
    tokens: 0,
    ...overrides,
  }
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  const run = overrides.result ?? result()
  const target = probeTarget()
  return {
    toolVersion: '0.1.0',
    fingerprintsVersion: '0.1.0',
    run: {
      startedAt: '2026-09-24T08:15:00.000Z',
      finishedAt: '2026-09-24T08:15:41.882Z',
      profile: 'standard',
      spreadMs: 0,
      nonce: 'abcdefgh12',
      probeOrderSeed: 'seed1234',
      privateTargetsAllowed: false,
    },
    target,
    showEndpoint: false,
    result: run,
    scored: assess({
      signals: run.signals,
      outcomes: run.outcomes,
      dilution: run.dilution,
      pairing: target.pairing,
    }),
    secrets: [KEY],
    ...overrides,
  }
}

const RLO = String.fromCodePoint(0x202e)
const PDF = String.fromCodePoint(0x202c)
const HOSTILE = `boom \u001b[32mPASS\u001b[0m ${RLO}evil${PDF} | <script>alert(1)</script> [x](https://evil.example) ${KEY}`

describe('buildReport', () => {
  it('redacts a known key from every string, however deep', async () => {
    const leaky = signal({ llr: { identity: { 'matches-claim': 0.3 } } })
    const run = result({
      signals: [{ ...leaky, observed: `error: invalid key ${KEY}` }],
      evidence: [evidence({ probeId: `probe ${KEY}` })],
    })
    const report = await buildReport(input({ result: run }))
    const json = renderJson(report)
    expect(json).not.toContain(KEY)
    expect(json).toContain('[REDACTED]')
    expect(renderMarkdown(report)).not.toContain(KEY)
    expect(renderTerminal(report)).not.toContain(KEY)
  })

  it('hashes the endpoint and publishes it only on request', async () => {
    const hidden = await buildReport(input())
    expect(hidden.target.endpoint).toBeNull()
    expect(hidden.target.endpointHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(hidden.target.endpointHash).toBe(await endpointHash(probeTarget().endpoint))

    const shown = await buildReport(input({ showEndpoint: true }))
    expect(shown.target.endpoint).toBe(probeTarget().endpoint.root)
    expect(shown.target.endpointHash).toBe(hidden.target.endpointHash)
  })

  it('records the name the model was sold under, and prints it only when it differs', async () => {
    const plain = await buildReport(input())
    expect(plain.target.requestedModel).toBe('claude-opus-5-5')
    expect(renderMarkdown(plain)).not.toContain('Sold as')
    expect(renderTerminal(plain)).not.toContain('Sold as')

    const target = probeTarget({
      model: 'claude-opus-4-6',
      requestedModel: 'reseller/claude-opus-4.6',
    })
    const mapped = await buildReport(input({ target }))
    expect(mapped.target).toMatchObject({
      claimedModel: 'claude-opus-4-6',
      requestedModel: 'reseller/claude-opus-4.6',
    })
    expect(renderMarkdown(mapped)).toContain('- **Sold as:** reseller/claude-opus-4.6')
    expect(renderTerminal(mapped)).toMatch(/Sold as\s+reseller\/claude-opus-4\.6/)
  })

  it('records how the key was sent, and prints it', async () => {
    const plain = await buildReport(input())
    const bearer = await buildReport(input({ target: { ...probeTarget(), auth: 'bearer' } }))

    expect(plain.target.auth).toBe('x-api-key')
    expect(renderMarkdown(plain)).toContain('- **Key sent as:** x-api-key header')
    expect(bearer.target.auth).toBe('bearer')
    expect(renderTerminal(bearer)).toMatch(/Key sent as\s+bearer token/)
  })

  it('refuses a headline its assessment and confidence do not give', async () => {
    const base = input()
    const forged = { ...base.scored, headline: 'pass' as const }
    await expect(buildReport({ ...base, scored: forged })).rejects.toThrow(TypeError)
  })

  it('freezes the finished document', async () => {
    const report = await buildReport(input())
    expect(Object.isFrozen(report)).toBe(true)
    expect(Object.isFrozen(report.signals)).toBe(true)
    expect(Object.isFrozen(report.verdict.assessment)).toBe(true)
  })

  it('carries the scoring through unchanged', async () => {
    const base = input()
    const report = await buildReport(base)
    expect(report.verdict.confidence).toBe(base.scored.confidence)
    expect(report.verdict.confidenceCeiling).toBe(base.scored.ceiling.value)
    expect(report.verdict.ceilingReasons).toEqual(base.scored.ceiling.reasons)
    expect(report.posteriors).toEqual(base.scored.posteriors)
    expect(report.skipped).toEqual(base.result.skipped)
    expect(report.reportVersion).toBe(1)
  })
})

describe('plainLanguageFor', () => {
  const clean: Assessment = {
    identity: 'matches-claim',
    consistency: 'uniform',
    platform: 'first-party',
    translation: 'direct',
    evidence: 'sufficient',
  }
  const say = (headline: 'pass' | 'caution' | 'fail', assessment: Partial<Assessment>) =>
    plainLanguageFor({
      headline,
      assessment: { ...clean, ...assessment },
      claimedModel: 'claude-opus-5-5',
      claimedVendor: 'anthropic',
    })

  it('clears only a pass', () => {
    expect(say('pass', {})).toContain('in every check that ran')
  })

  it('says what a failing endpoint behaved like, never why', () => {
    expect(say('fail', { identity: 'same-vendor-cheaper' })).toContain('cheaper or older Anthropic')
    expect(say('fail', { identity: 'different-vendor' })).toContain('other than Anthropic')
    expect(say('fail', { identity: 'not-a-live-model' })).toContain('canned or replayed')
    expect(say('fail', { identity: 'unknown', consistency: 'fractional' })).toContain(
      'only part of the requests',
    )
    for (const sentence of [say('fail', { identity: 'different-vendor' })]) {
      expect(sentence).not.toMatch(/fraud|scam|lie|cheat/i)
    }
  })

  it('names what stood in the way of a caution', () => {
    expect(say('caution', { identity: 'different-vendor' })).toContain('not strongly enough')
    expect(say('caution', { identity: 'unknown', consistency: 'fractional' })).toContain(
      'not strongly enough',
    )
    expect(say('caution', { identity: 'unknown', evidence: 'obstructed' })).toContain(
      'refused or failed',
    )
    expect(say('caution', { identity: 'unknown' })).toContain('could not tell')
    expect(say('caution', { consistency: 'unknown' })).toContain('too few repeated checks')
    expect(say('caution', {})).toContain('too few kinds of check')
  })
})

describe('plainText', () => {
  it('removes terminal escapes, controls and reordering marks', () => {
    const text = plainText(HOSTILE)
    const unsafe = Array.from(text, (char) => char.codePointAt(0) ?? 0).filter(
      (code) =>
        code < 0x20 ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x200e ||
        code === 0x200f ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069),
    )
    expect(unsafe).toEqual([])
    expect(text).toContain('PASS')
    expect(plainText('one\ntwo\r\nthree\ttab')).toBe('one two  three tab')
  })

  it('keeps ordinary non-ASCII text', () => {
    expect(plainText('日本語 · café 🙂')).toBe('日本語 · café 🙂')
  })
})

describe('markdownText', () => {
  it('leaves nothing that renders as markup', () => {
    const text = markdownText(HOSTILE)
    expect(text).not.toContain('<script>')
    expect(text).toContain('&lt;script&gt;')
    expect(text).toContain('\\|')
    expect(text).toContain('\\[x\\]')
    expect(markdownText('a & b')).toBe('a &amp; b')
    expect(markdownText('*_`#~\\')).toBe('\\*\\_\\`\\#\\~\\\\')
  })
})

describe('text helpers', () => {
  it('reads the stance off the identity weights and vetoes', () => {
    expect(stanceOf(signal({ llr: { identity: { 'matches-claim': 0.4 } } }))).toBe('supports')
    expect(stanceOf(signal({ llr: { identity: { 'different-vendor': 0.4 } } }))).toBe('against')
    expect(stanceOf(signal({ llr: { identity: { 'matches-claim': -0.4 } } }))).toBe('against')
    expect(stanceOf(signal({ llr: { platform: { 'partner-cloud': 1 } } }))).toBe('context')
    expect(stanceOf(signal({ llr: {}, vetoes: ['matches-claim'] }))).toBe('against')
  })

  it('prints each weight with its sign', () => {
    const weighed = signal({
      llr: { identity: { 'matches-claim': 0.3, 'different-vendor': -0.6 } },
      vetoes: ['not-a-live-model'],
    })
    expect(weightOf(weighed)).toBe(
      'identity matches-claim +0.30, different-vendor -0.60; rules out not-a-live-model',
    )
    expect(weightOf(signal({ llr: {} }))).toBe('no weight')
  })

  it('numbers each distinct citation once', () => {
    const first = signal({ llr: {} })
    const other = {
      ...signal({ llr: {} }),
      citations: [
        { url: 'https://example.com/b', quote: 'B.', retrievedAt: '2026-09-01' },
        ...first.citations,
      ],
    } as const
    const notes = footnotesOf([first, other, first])
    expect(notes.sources).toHaveLength(2)
    expect(notes.numbers).toEqual([[1], [2, 1], [1]])
  })

  it('prints the stored interval rather than recomputing one', () => {
    const epsilon = {
      ...epsilonOf(draws(`dd${'a'.repeat(28)}`)),
      interval: [0.0123, 0.4567] as const,
    }
    const summary = epsilonSummary(epsilon)
    expect(summary).toContain(
      "2 of 30 repeated checks disagreed with the claimed model's known answer",
    )
    expect(summary).toContain('the share of checks that do is 1.2% to 45.7%')
    // A check is more than one request, and a majority need not be the claimed model.
    expect(summary).not.toContain('share not reaching the claimed model')
    expect(epsilonSummary({ ...epsilon, basis: 'mode' })).toContain(
      "disagreed with the run's most common answer",
    )
    expect(epsilonSummary({ ...epsilonOf(draws('ll')), estimate: null })).toContain('2 lost')
  })

  it('counts requests by status', () => {
    const entries = [
      evidence(),
      evidence({ status: 400 }),
      evidence({ status: 400 }),
      evidence({ status: null, responseDigest: null, failure: 'timeout' }),
    ]
    expect(evidenceSummary(entries)).toBe('4 requests: 200 x1, 400 x2, no response x1')
    expect(evidenceSummary([evidence()])).toBe('1 request: 200 x1')
    expect(evidenceSummary([])).toBe('no requests')
  })
})

async function hostileReport(): Promise<Report> {
  const base = signal({ llr: { identity: { 'different-vendor': 0.4 } } })
  const run = result({
    signals: [{ ...base, observed: HOSTILE, plainLanguage: HOSTILE }],
    evidence: [
      evidence({ probeId: HOSTILE }),
      evidence({ status: null, failure: 'timeout', draw: 1 }),
    ],
    dilution: draws(`d${'a'.repeat(29)}`),
    outcomes: [...ran('ABCD'), ...ran('F')],
  })
  return buildReport(input({ result: run }))
}

/** Wraps each painted run in a tag named for its style, so a test can see what was painted. */
const tag = (name: string) => (text: string) => `<${name}>${text}</${name}>`
const TAGGED: TerminalStyle = {
  pass: tag('pass'),
  caution: tag('caution'),
  fail: tag('fail'),
  supports: tag('supports'),
  against: tag('against'),
  context: tag('context'),
  bold: tag('b'),
  dim: tag('dim'),
}

describe('renderTerminal', () => {
  it('prints the verdict, findings, signals, gaps, sources and disclaimer', async () => {
    const text = renderTerminal(await hostileReport())
    expect(text).toMatch(/^VerifAI 0\.1\.0/)
    expect(text).toContain('confidence')
    expect(text).toContain('address hidden')
    expect(text).toContain('Findings')
    expect(text).toContain('1 of 30 repeated checks disagreed')
    expect(text).toContain('Skipped (1)')
    expect(text).toContain('would have passed the request or token budget')
    expect(text).toContain('[1] https://platform.claude.com/docs/en/api/messages')
    expect(text).toContain(DISCLAIMER)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('lets no escape sequence from the endpoint through', async () => {
    const text = renderTerminal(await hostileReport())
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain(RLO)
  })

  it('paints with the style it is given', async () => {
    const report = await hostileReport()
    const text = renderTerminal(report, TAGGED)
    expect(text).toContain(`<${report.verdict.headline}>`)
    expect(text).toContain('<against>against</against>')
  })

  it('names which way each signal leans in words, and says what the words mean', async () => {
    const text = renderTerminal(await hostileReport())
    expect(text).toContain(
      'Signals (1)\n  Each leans for or against the claimed model, or is neutral.',
    )
    expect(text).toMatch(/^ {2}against {2}test\/probe-\d+ \/ reading /m)
    expect(text).not.toContain('›')
  })

  it('pads a short stance word so every probe id starts in the same column', async () => {
    const run = result({
      signals: [
        signal({ llr: { identity: { 'matches-claim': 0.4 } } }),
        signal({ llr: { identity: { 'different-vendor': 0.4 } } }),
      ],
    })
    const report = await buildReport(input({ result: run }))
    const plain = renderTerminal(report)

    expect(plain).toMatch(/^ {2}for {4} {2}test\/probe-\d+ /m)
    expect(plain).toMatch(/^ {2}against {2}test\/probe-\d+ /m)
    // The padding stays outside the paint, so a coloured word does not carry trailing spaces.
    expect(renderTerminal(report, TAGGED)).toMatch(/^ {2}<supports>for<\/supports> {6}test\//m)
  })

  it('says when private targets were allowed and when nothing was signalled', async () => {
    const base = input({ result: result({ signals: [], evidence: [] }) })
    const report = await buildReport({ ...base, run: { ...base.run, privateTargetsAllowed: true } })
    const text = renderTerminal(report)
    expect(text).toContain('private network targets were allowed')
    expect(text).toContain('No probe produced a signal.')
    expect(text).toContain('no requests')
  })
})

describe('renderMarkdown', () => {
  it('renders every section with the hostile text inert', async () => {
    const text = renderMarkdown(await hostileReport())
    expect(text).toMatch(/^# VerifAI report: /)
    expect(text).toContain('## Findings')
    expect(text).toContain('## Signals (1)')
    expect(text).toContain('## Skipped (1)')
    expect(text).toContain('## Evidence')
    expect(text).toContain('| 2 | test/probe | none (timeout) |')
    expect(text).toContain('[^1]: <https://platform.claude.com/docs/en/api/messages>')
    expect(text).not.toContain('<script>')
    expect(text).toContain(String.raw`\[x\](https://evil.example)`)
    expect(text.replaceAll(String.raw`\]`, '')).not.toContain('](')
    expect(text).not.toContain('\u001b')
    expect(text).toContain(DISCLAIMER)
  })

  it('shows a published endpoint and an empty run', async () => {
    const base = input({ result: result({ signals: [], evidence: [], skipped: [] }) })
    const report = await buildReport({
      ...base,
      showEndpoint: true,
      run: { ...base.run, privateTargetsAllowed: true },
    })
    const text = renderMarkdown(report)
    expect(text).toContain('https://api.anthropic.com/v1')
    expect(text).toContain('No probe produced a signal.')
    expect(text).toContain('No requests were sent.')
    expect(text).toContain('private network targets were allowed')
    expect(text).not.toContain('## Skipped')
  })
})

describe('renderJson', () => {
  it('round-trips the report exactly', async () => {
    const report = await hostileReport()
    expect(JSON.parse(renderJson(report))).toEqual(JSON.parse(JSON.stringify(report)))
    expect(renderJson(report).endsWith('}\n')).toBe(true)
  })
})
