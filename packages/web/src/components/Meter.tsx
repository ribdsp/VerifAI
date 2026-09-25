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
    <div className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-sm">
      <span className="eyebrow">{label}</span>
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
      <span className="font-mono text-xs whitespace-nowrap">{text}</span>
    </div>
  )
}
