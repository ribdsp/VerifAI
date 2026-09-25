import type { DrawRecord, DrawRecordOutcome } from '@verifai/core'
import { drawCounts, formatCount } from '../lib/format'

interface DrawStripProps {
  readonly draws: readonly DrawRecord[]
  /** How many draws were asked for; the rest of the strip shows as not yet drawn. */
  readonly planned?: number
  /** The last draw taken; one taken without an outcome is waiting for the run's majority. */
  readonly taken?: number
}

type SquareKind = DrawRecordOutcome | 'pending' | 'not-drawn'

/**
 * Each kind of square has a mark or a texture as well as a colour, so the strip
 * reads in greyscale, and the words the key and the screen reader give it.
 */
const SQUARES: Readonly<
  Record<SquareKind, { readonly className: string; readonly mark: string; readonly words: string }>
> = {
  agree: { className: 'bg-pass border-pass text-sheet', mark: '', words: 'agreed' },
  disagree: { className: 'bg-fail border-fail text-sheet', mark: '✕', words: 'disagreed' },
  lost: { className: 'border-dashed border-ink-faint text-ink-faint', mark: '?', words: 'lost' },
  excluded: { className: 'hatch border-ink-faint text-ink-faint', mark: '', words: 'excluded' },
  pending: {
    className: 'border-ink-faint bg-paper text-ink-faint',
    mark: '·',
    words: 'taken, not yet judged',
  },
  'not-drawn': { className: 'border-rule bg-sheet', mark: '', words: 'not yet drawn' },
}

const OUTCOMES: readonly DrawRecordOutcome[] = ['agree', 'disagree', 'lost', 'excluded']

const KEY_ORDER: readonly SquareKind[] = [...OUTCOMES, 'pending', 'not-drawn']

const SQUARE =
  'grid size-3.5 shrink-0 place-items-center border font-mono text-[0.55rem] leading-none'

function kindOf(outcome: DrawRecordOutcome | undefined, isTaken: boolean): SquareKind {
  if (outcome !== undefined) {
    return outcome
  }
  return isTaken ? 'pending' : 'not-drawn'
}

/** The Group F draws in the order sent: one square per draw, and a key to the kinds shown. */
export function DrawStrip({ draws, planned = 0, taken = 0 }: DrawStripProps) {
  const byDraw = new Map(draws.map((record) => [record.draw, record.outcome]))
  const length = Math.max(planned, taken, ...draws.map((record) => record.draw), 0)
  const kinds = Array.from({ length }, (_, index) =>
    kindOf(byDraw.get(index + 1), index + 1 <= taken),
  )
  const shown = KEY_ORDER.filter((kind) => kinds.includes(kind))
  const counts = drawCounts(draws)
  const pending = Math.max(0, taken - draws.filter((record) => record.draw <= taken).length)
  const summary = [
    ...(pending > 0 ? [`${formatCount(pending)} taken, judged once every draw is in`] : []),
    ...OUTCOMES.filter((outcome) => counts[outcome] > 0).map(
      (outcome) => `${formatCount(counts[outcome])} ${SQUARES[outcome].words}`,
    ),
  ].join(', ')
  const remaining = Math.max(0, length - draws.length - pending)
  return (
    <figure className="space-y-2">
      <ol className="flex flex-wrap gap-0.5" aria-label="Routing-dilution draws, in order">
        {kinds.map((kind, index) => {
          const draw = index + 1
          const square = SQUARES[kind]
          const label = `Draw ${draw}: ${square.words}`
          return (
            <li
              key={draw}
              title={label}
              aria-label={label}
              className={`${SQUARE} ${square.className}`}
            >
              <span aria-hidden="true">{square.mark}</span>
            </li>
          )
        })}
      </ol>
      <figcaption className="space-y-1.5 font-mono text-xs text-ink-soft">
        <p>
          {summary === '' ? 'No draws yet' : summary}
          {remaining > 0 ? `; ${formatCount(remaining)} to go` : ''}
        </p>
        {shown.length === 0 ? null : (
          // Each square already names itself to a screen reader; the key is for the eye.
          <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-ink-faint">
            {shown.map((kind) => (
              <li key={kind} className="flex items-center gap-1.5">
                <span className={`${SQUARE} ${SQUARES[kind].className}`}>{SQUARES[kind].mark}</span>
                {SQUARES[kind].words}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  )
}
