import type { ReactNode } from 'react'
import { describeProblem } from '../lib/format'

interface FieldProps {
  /** The control's `id`; the hint and problems hang off it. */
  readonly id: string
  readonly label: string
  readonly hint?: ReactNode
  readonly problems?: readonly string[] | undefined
  readonly children: (describedBy: string | undefined, invalid: boolean) => ReactNode
}

/** One line of the form: label in the left column, control and notes on the right. */
export function Field({ id, label, hint, problems = [], children }: FieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`
  const problemId = problems.length === 0 ? undefined : `${id}-problem`
  const describedBy =
    [problemId, hintId].filter((part) => part !== undefined).join(' ') || undefined
  return (
    <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[13rem_1fr]">
      <label htmlFor={id} className="pt-1.5 font-semibold">
        {label}
      </label>
      <div>
        {children(describedBy, problems.length > 0)}
        {problemId === undefined ? null : (
          // Written out as well as set in red, so the colour is not the only sign.
          <p id={problemId} className="mt-1 font-mono text-xs text-fail">
            <span className="font-semibold">Problem:</span>{' '}
            {problems.map(describeProblem).join('; ')}
          </p>
        )}
        {hintId === undefined ? null : (
          <p id={hintId} className="mt-1 text-sm text-ink-faint">
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}
