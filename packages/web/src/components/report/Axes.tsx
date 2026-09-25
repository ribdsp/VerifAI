import type { ReportVerdict } from '@verifai/core'
import { formatInterval } from '../../lib/format'
import { AXES, AXIS_KEYS, findingLabel } from '../../lib/labels'

/** The five axes. The interval beside consistency is the stored one, never re-derived. */
export function Axes({ verdict }: { readonly verdict: ReportVerdict }) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th scope="col">Axis</th>
          <th scope="col">Question</th>
          <th scope="col">Finding</th>
        </tr>
      </thead>
      <tbody>
        {AXIS_KEYS.map((key) => {
          const finding: string = verdict.assessment[key]
          const isOpen = finding === 'unknown'
          return (
            <tr key={key}>
              <th scope="row" className="font-semibold whitespace-nowrap">
                {AXES[key].axis}
              </th>
              <td className="text-ink-soft">{AXES[key].question}</td>
              <td className={isOpen ? 'text-ink-faint italic' : 'font-semibold'}>
                {findingLabel(key, finding)}
                {key === 'consistency' && verdict.epsilon !== null ? (
                  <span className="block font-mono text-xs font-normal text-ink-soft not-italic">
                    disagreement rate {formatInterval(verdict.epsilon.interval)}
                  </span>
                ) : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
