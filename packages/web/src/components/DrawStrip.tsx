import type { DrawRecord, DrawRecordOutcome } from '@verifai/core'
import { drawCounts, formatCount } from '../lib/format'

interface DrawStripProps {
  readonly draws: readonly DrawRecord[]
  /** How many draws were asked for; the rest of the strip shows as not yet drawn. */
  readonly planned?: number
  /** The last draw taken; one taken without an outcome is waiting for the run's majority. */
  readonly taken?: number
}

/** Each outcome has a mark as well as a colour, so the strip reads in greyscale. */
const CELLS: Readonly<Record<DrawRecordOutcome, { className: string; mark: string }>> = {
  agree: { className: 'bg-pass border-pass text-sheet', mark: '' },
  disagree: { className: 'bg-fail border-fail text-sheet', mark: '✕' },
  lost: { className: 'border-dashed border-ink-faint text-ink-faint', mark: '?' },
  excluded: { className: 'hatch border-ink-faint text-ink-faint', mark: '' },
}

const OUTCOME_WORDS: Readonly<Record<DrawRecordOutcome, string>> = {
  agree: 'agreed',
  disagree: 'disagreed',
  lost: 'lost',
  excluded: 'excluded',
}

const ORDER: readonly DrawRecordOutcome[] = ['agree', 'disagree', 'lost', 'excluded']

const PENDING = { className: 'border-ink-faint bg-paper text-ink-faint', mark: '·' } as const

function stateOf(outcome: DrawRecordOutcome | undefined, isTaken: boolean): string {
  if (outcome !== undefined) {
    return outcome
  }
  return isTaken ? 'taken, not yet judged' : 'not yet drawn'
}

/** The Group F draws in the order sent: one square per draw. */
export function DrawStrip({ draws, planned = 0, taken = 0 }: DrawStripProps) {
  const byDraw = new Map(draws.map((record) => [record.draw, record.outcome]))
  const length = Math.max(planned, taken, ...draws.map((record) => record.draw), 0)
  const counts = drawCounts(draws)
  const pending = Math.max(0, taken - draws.filter((record) => record.draw <= taken).length)
  const summary = [
    ...(pending > 0 ? [`${formatCount(pending)} taken, judged once every draw is in`] : []),
    ...ORDER.filter((outcome) => counts[outcome] > 0).map(
      (outcome) => `${formatCount(counts[outcome])} ${OUTCOME_WORDS[outcome]}`,
    ),
  ].join(', ')
  const remaining = Math.max(0, length - draws.length - pending)
  return (
    <figure className="space-y-2">
      <ol className="flex flex-wrap gap-0.5" aria-label="Routing-dilution draws, in order">
        {Array.from({ length }, (_, index) => {
          const draw = index + 1
          const outcome = byDraw.get(draw)
          const isTaken = draw <= taken
          const cell = outcome === undefined ? (isTaken ? PENDING : undefined) : CELLS[outcome]
          const state = stateOf(outcome, isTaken)
          return (
            <li
              key={draw}
              title={`Draw ${draw}: ${state}`}
              aria-label={`Draw ${draw}: ${state}`}
              className={`grid size-3.5 place-items-center border font-mono text-[0.55rem] leading-none ${
                cell === undefined ? 'border-rule bg-sheet' : cell.className
              }`}
            >
              <span aria-hidden="true">{cell?.mark}</span>
            </li>
          )
        })}
      </ol>
      <figcaption className="font-mono text-xs text-ink-soft">
        {summary === '' ? 'No draws yet' : summary}
        {remaining > 0 ? `; ${formatCount(remaining)} to go` : ''}
      </figcaption>
    </figure>
  )
}
