/**
 * The views, rendered to static markup in Node: no DOM, no effects. What this
 * covers is what a view shows for a given state, which is where a report
 * viewer can go wrong by recomputing a figure or linking an unsafe URL.
 */

import type { Report } from '@verifai/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from '../src/App'
import { CheckForm } from '../src/components/CheckForm'
import { EstimateView } from '../src/components/EstimateView'
import { FinalView } from '../src/components/FinalView'
import { ReportView } from '../src/components/ReportView'
import { createApiClient } from '../src/lib/api'
import { initialFormValues } from '../src/lib/request'
import { CREATED, fakeFetch, OPTIONS, REPORT, SIGNAL, TOKEN } from './fixtures'

const client = createApiClient({ fetch: fakeFetch().fetch, token: () => TOKEN })
const noop = () => {}

function reportMarkup(report: Report = REPORT): string {
  return renderToStaticMarkup(
    createElement(ReportView, { client, checkId: CREATED.checkId, report, onRestart: noop }),
  )
}

function withCitationUrl(url: string, quote = SIGNAL.citations[0].quote): Report {
  return {
    ...REPORT,
    signals: [{ ...SIGNAL, citations: [{ url, quote, retrievedAt: '2026-09-01' }] }],
  }
}

describe('ReportView', () => {
  it('shows the stored headline, sentence and confidence against its ceiling', () => {
    const html = reportMarkup()

    expect(html).toContain('Pass')
    expect(html).toContain('✓')
    expect(html).toContain(REPORT.verdict.plainLanguage)
    expect(html).toContain('82% of a 90% ceiling')
    expect(html).toContain('The causal capability probes (Group D) did not run.')
  })

  it('shows the five axes, the epsilon interval and the posteriors as stored', () => {
    const html = reportMarkup()

    for (const finding of ['Matches the claim', 'Uniform', 'First-party', 'Direct', 'Sufficient']) {
      expect(html).toContain(finding)
    }
    expect(html).toContain('0.2% – 19.0%')
    expect(html).toContain('4.3%')
    expect(html).toContain('0.910')
    expect(html).toContain('0.050')
  })

  it('links an https citation in a new tab without a referrer, and quotes it verbatim', () => {
    const html = reportMarkup()

    expect(html).toContain(
      '<a href="https://docs.example.com/messages" target="_blank" rel="noreferrer noopener"',
    )
    expect(html).toContain('The response object has a &quot;type&quot; of &quot;message&quot;.')
  })

  it.each(['javascript:alert(1)', 'http://docs.example.com/', 'data:text/html,hi'])(
    'shows %j as text, never as a link',
    (url) => {
      const html = reportMarkup(withCitationUrl(url))

      expect(html).not.toMatch(/<a\s[^>]*href=/)
      expect(html).toContain(url.replaceAll('&', '&amp;'))
    },
  )

  it('escapes markup inside report text', () => {
    const html = reportMarkup(withCitationUrl('https://docs.example.com/', '<script>x()</script>'))

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;x()&lt;/script&gt;')
  })

  it('shows the endpoint only when the report carries it', () => {
    const hidden = reportMarkup()
    const shown = reportMarkup({
      ...REPORT,
      target: { ...REPORT.target, endpoint: 'https://api.example.com/v1' },
    })

    expect(hidden).toContain(REPORT.target.endpointHash)
    expect(hidden).not.toContain('>Endpoint<')
    expect(shown).toContain('https://api.example.com/v1')
  })

  it("shows the gateway's name for the model only when it differs from the claim", () => {
    const plain = reportMarkup()
    const mapped = reportMarkup({
      ...REPORT,
      target: { ...REPORT.target, requestedModel: 'reseller/claude-sonnet-5' },
    })

    expect(plain).not.toContain('Sold as')
    expect(mapped).toContain('Sold as')
    expect(mapped).toContain('reseller/claude-sonnet-5')
  })

  it('says how the key was sent', () => {
    const bearer = reportMarkup({ ...REPORT, target: { ...REPORT.target, auth: 'bearer' } })

    expect(reportMarkup()).toContain('x-api-key header')
    expect(bearer).toContain('bearer token (Authorization header)')
  })

  it('lists skipped probes with their reason and counts the evidence', () => {
    const html = reportMarkup()

    expect(html).toContain('Needs an API key, and this run has none.')
    expect(html).toContain('D2')
    expect(html).toContain('Unsigned')
  })

  it('leaves out the dilution section when the run measured none', () => {
    const html = reportMarkup({ ...REPORT, verdict: { ...REPORT.verdict, epsilon: null } })

    expect(html).not.toContain('Routing dilution')
  })
})

describe('FinalView', () => {
  it('says why there is no report, in the daemon’s words', () => {
    const html = renderToStaticMarkup(
      createElement(FinalView, {
        state: 'stopped',
        error: { code: 'invalid-key', message: 'The endpoint refused the key.' },
        onRestart: noop,
      }),
    )

    expect(html).toContain('The endpoint stopped the check')
    expect(html).toContain('invalid-key')
    expect(html).toContain('The endpoint refused the key.')
  })
})

describe('EstimateView', () => {
  it('shows the plan by group, what it leaves out, and the warnings', () => {
    const html = renderToStaticMarkup(
      createElement(EstimateView, {
        client,
        created: CREATED,
        onStarted: noop,
        onCancelled: noop,
      }),
    )

    expect(html).toContain('Protocol conformance')
    expect(html).toContain('Routing dilution')
    expect(html).toContain('Needs an API key, and this run has none.')
    expect(html).toContain('x-api-key header')
    expect(html).toContain('120')
    expect(html).toContain('200')
    expect(html).toMatch(/Start/)
    expect(html).toMatch(/Cancel/)
  })
})

describe('CheckForm', () => {
  it('starts with an empty password field for the key', () => {
    const html = renderToStaticMarkup(
      createElement(CheckForm, {
        client,
        options: OPTIONS,
        values: initialFormValues(OPTIONS),
        onValuesChange: noop,
        onCreated: noop,
      }),
    )
    const keyInput = /<input[^>]*id="api-key"[^>]*>/.exec(html)?.[0] ?? ''

    expect(keyInput).toContain('type="password"')
    expect(keyInput).toContain('autoComplete="off"')
    expect(keyInput).toContain('spellCheck="false"')
    expect(keyInput).toContain('value=""')
  })
})

describe('App', () => {
  it('explains a missing session instead of calling the daemon', () => {
    const html = renderToStaticMarkup(createElement(App, { client, hasSession: false }))

    expect(html).toContain('opened without its session link')
  })

  it('waits for the daemon when it has a session', () => {
    const html = renderToStaticMarkup(createElement(App, { client, hasSession: true }))

    expect(html).toContain('Reaching the local daemon')
  })
})
