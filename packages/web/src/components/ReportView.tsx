import type { Report } from '@verifai/core'
import type { ApiClient } from '../lib/api'
import { formatInterval, plural } from '../lib/format'
import { Axes } from './report/Axes'
import { Downloads } from './report/Downloads'
import { EpsilonBlock } from './report/EpsilonBlock'
import { RunParticulars, SkippedProbes, TargetParticulars } from './report/Particulars'
import { PosteriorBars } from './report/PosteriorBars'
import { Signals } from './report/Signals'
import { Verdict } from './report/Verdict'
import { Section } from './Section'

interface ReportViewProps {
  readonly client: ApiClient
  readonly checkId: string
  readonly report: Report
  readonly onRestart: () => void
}

/**
 * The report as stored. Every figure is the daemon's; this view formats and
 * never recomputes, so what it shows matches the downloads to the digit.
 */
export function ReportView({ client, checkId, report, onRestart }: ReportViewProps) {
  const { verdict } = report
  return (
    <div className="space-y-2">
      <Verdict verdict={verdict} claimedModel={report.target.claimedModel} />

      <div className="pt-6">
        <Section mark="R.1" title="Five axes" order={1}>
          <Axes verdict={verdict} />
        </Section>
      </div>

      {verdict.epsilon === null ? null : (
        <Section
          mark="R.2"
          title="Routing dilution"
          aside={`ε ${formatInterval(verdict.epsilon.interval)}`}
          order={2}
        >
          <EpsilonBlock epsilon={verdict.epsilon} />
        </Section>
      )}

      <Section mark="R.3" title="Posteriors" aside="As stored" order={3}>
        <PosteriorBars posteriors={report.posteriors} verdict={verdict} />
      </Section>

      <Section
        mark="R.4"
        title="Evidence"
        aside={plural(report.signals.length, 'signal')}
        order={4}
      >
        <details className="group">
          <summary className="cursor-pointer py-1 font-mono text-sm text-ink-soft select-none">
            <span
              aria-hidden="true"
              className="inline-block transition-transform group-open:rotate-90"
            >
              ▸
            </span>{' '}
            Every signal, with what was expected and the source it rests on
          </summary>
          <div className="pt-3">
            <Signals signals={report.signals} />
          </div>
        </details>
      </Section>

      <Section mark="R.5" title="Target" order={5}>
        <TargetParticulars report={report} />
      </Section>

      <Section mark="R.6" title="Run" order={6}>
        <RunParticulars report={report} />
      </Section>

      <Section
        mark="R.7"
        title="Probes left out"
        aside={plural(report.skipped.length, 'probe')}
        order={7}
      >
        <SkippedProbes report={report} />
      </Section>

      <Section mark="R.8" title="Copies" order={8}>
        <Downloads client={client} checkId={checkId} />
      </Section>

      <div className="reveal border-t border-ink pt-4">
        <button type="button" className="button button-primary" onClick={onRestart}>
          New check
        </button>
      </div>
    </div>
  )
}
