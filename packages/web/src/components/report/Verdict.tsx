import type { ReportVerdict, Verdict as VerdictCode } from '@verifai/core'
import { formatPercent } from '../../lib/format'
import { ceilingReasonText, VERDICT_DISPLAY } from '../../lib/labels'
import { Meter } from '../Meter'

const TONES: Readonly<
  Record<VerdictCode, { readonly box: string; readonly meter: 'pass' | 'caution' | 'fail' }>
> = {
  pass: { box: 'border-pass bg-pass-wash text-pass', meter: 'pass' },
  caution: { box: 'border-caution bg-caution-wash text-caution', meter: 'caution' },
  fail: { box: 'border-fail bg-fail-wash text-fail', meter: 'fail' },
}

interface VerdictProps {
  readonly verdict: ReportVerdict
  readonly claimedModel: string
}

/** The headline as a stamp on the record: the one thing to read if nothing else is. */
export function Verdict({ verdict, claimedModel }: VerdictProps) {
  const display = VERDICT_DISPLAY[verdict.headline]
  const tone = TONES[verdict.headline]
  const confidence = formatPercent(verdict.confidence, 0)
  const ceiling = formatPercent(verdict.confidenceCeiling, 0)
  return (
    <section
      aria-labelledby="verdict-heading"
      className={`reveal border-y-2 px-4 py-6 sm:px-6 ${tone.box}`}
    >
      <h2 id="verdict-heading" className="eyebrow">
        Verdict on the claim{' '}
        <span className="font-semibold normal-case tracking-normal text-ink">{claimedModel}</span>
      </h2>
      <div className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-5">
        <p className="stamp animate-stamp text-4xl sm:text-5xl">
          <span aria-hidden="true">{display.glyph}</span>
          {display.label}
        </p>
        <p className="max-w-prose flex-1 basis-80 text-xl leading-snug text-ink sm:text-2xl">
          {verdict.plainLanguage}
        </p>
      </div>
      <p className="mt-5 max-w-prose text-sm text-ink-soft">{display.summary}</p>
      <div className="mt-5 space-y-2 text-ink">
        <Meter
          label="Confidence"
          value={verdict.confidence}
          max={1}
          text={`${confidence} of a ${ceiling} ceiling`}
          marker={{ value: verdict.confidenceCeiling, label: `Confidence ceiling, ${ceiling}` }}
          tone={tone.meter}
        />
        {verdict.ceilingReasons.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing in this run held the ceiling down.</p>
        ) : (
          <div className="text-sm text-ink-soft">
            <p>The ceiling is {ceiling} because:</p>
            <ul className="mt-1 list-disc pl-5">
              {verdict.ceilingReasons.map((reason) => (
                <li key={reason}>{ceilingReasonText(reason)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
