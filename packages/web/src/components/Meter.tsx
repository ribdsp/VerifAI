import { shareOf } from '../lib/format'

interface MeterProps {
  readonly label: string
  readonly value: number
  readonly max: number
  /** What the reader sees beside the bar, already formatted. */
  readonly text: string
  /** A second mark on the scale, such as the confidence ceiling. */
  readonly marker?: { readonly value: number; readonly label: string }
  readonly tone?: 'ink' | 'pass' | 'caution' | 'fail'
}

const FILLS = { ink: 'bg-ink', pass: 'bg-pass', caution: 'bg-caution', fail: 'bg-fail' } as const

/** A ruled bar: the stored figure against its scale, with the figure always in text. */
export function Meter({ label, value, max, text, marker, tone = 'ink' }: MeterProps) {
  const filled = shareOf(value, max)
  return (
    // On a narrow screen the label takes its own line, so the bar keeps its width.
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[9rem_1fr_auto]">
      <span className="eyebrow col-span-2 sm:col-span-1">{label}</span>
      {/* The bar repeats the text beside it, so assistive technology reads the text alone. */}
      <div aria-hidden="true" className="relative h-3 border border-ink bg-sheet">
        <div
          className={`h-full ${FILLS[tone]} transition-[width] duration-300`}
          style={{ width: `${filled * 100}%` }}
        />
        {marker === undefined ? null : (
          <div
            title={marker.label}
            className="absolute -top-1 -bottom-1 w-0 border-l-2 border-dashed border-margin"
            style={{ left: `${shareOf(marker.value, max) * 100}%` }}
          />
        )}
      </div>
      {/* A fixed floor on the figure's width keeps stacked meters' bars the same length. */}
      <span className="min-w-[18ch] text-right font-mono text-xs whitespace-nowrap">{text}</span>
    </div>
  )
}
