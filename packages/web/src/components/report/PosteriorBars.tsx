import type { Posteriors, ReportVerdict } from '@verifai/core'
import { formatProbability, shareOf } from '../../lib/format'
import { AXES, type AxisKey, findingLabel } from '../../lib/labels'

const INFERRED_AXES: readonly (keyof Posteriors & AxisKey)[] = [
  'identity',
  'consistency',
  'platform',
  'translation',
]

interface PosteriorBarsProps {
  readonly posteriors: Posteriors
  readonly verdict: ReportVerdict
}

/** Each inferred axis's distribution as stored, with the assessed finding marked. */
export function PosteriorBars({ posteriors, verdict }: PosteriorBarsProps) {
  return (
    <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
      {INFERRED_AXES.map((axis) => {
        const distribution: Readonly<Record<string, number>> = posteriors[axis]
        const assessed: string = verdict.assessment[axis]
        return (
          <figure key={axis}>
            <figcaption className="eyebrow mb-1">{AXES[axis].axis}</figcaption>
            <ul className="space-y-1">
              {Object.entries(distribution).map(([finding, probability]) => (
                <Bar
                  key={finding}
                  label={findingLabel(axis, finding)}
                  probability={probability}
                  isAssessed={finding === assessed}
                />
              ))}
            </ul>
          </figure>
        )
      })}
    </div>
  )
}

interface BarProps {
  readonly label: string
  readonly probability: number
  readonly isAssessed: boolean
}

function Bar({ label, probability, isAssessed }: BarProps) {
  return (
    <li className="grid grid-cols-[minmax(0,12rem)_1fr_3.5rem] items-center gap-2 text-sm">
      <span className={isAssessed ? 'font-semibold' : 'text-ink-soft'}>
        {isAssessed ? '▸ ' : ''}
        {label}
        {isAssessed ? <span className="sr-only"> (the assessed finding)</span> : null}
      </span>
      <span aria-hidden="true" className="h-2 border border-ink-faint bg-sheet">
        <span
          className={`block h-full ${isAssessed ? 'bg-ink' : 'bg-ink-faint'}`}
          style={{ width: `${shareOf(probability, 1) * 100}%` }}
        />
      </span>
      <span className="text-right font-mono text-xs">{formatProbability(probability)}</span>
    </li>
  )
}
