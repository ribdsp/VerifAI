import type { Epsilon } from '@verifai/core'
import { formatCount, formatInterval, formatPercent } from '../../lib/format'
import { BASIS_TEXT, labelOf } from '../../lib/labels'
import { DrawStrip } from '../DrawStrip'

/** Group F's measurement, figure by figure as stored. */
export function EpsilonBlock({ epsilon }: { readonly epsilon: Epsilon }) {
  const rows: readonly (readonly [string, string])[] = [
    ['Estimate', epsilon.estimate === null ? 'Not readable' : formatPercent(epsilon.estimate)],
    ['Interval', formatInterval(epsilon.interval)],
    ['Trials', formatCount(epsilon.trials)],
    ['Disagreements', formatCount(epsilon.disagreements)],
    ['Lost', formatCount(epsilon.lost)],
    ['Clustered', epsilon.clustered ? 'Yes: the disagreements came in runs' : 'No'],
    ['Probe', epsilon.probeId],
  ]
  return (
    <div className="space-y-4">
      <p className="max-w-prose">
        ε is the share of repeated checks that disagree. A check can be more than one request, so it
        is not the share of single requests. {labelOf(BASIS_TEXT, epsilon.basis)}
      </p>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="eyebrow pt-0.5">{term}</dt>
            <dd className="font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      <DrawStrip draws={epsilon.draws} />
    </div>
  )
}
