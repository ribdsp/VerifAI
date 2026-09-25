import type { Citation, Signal } from '@verifai/core'
import { groupSignals, safeHttpsUrl } from '../../lib/format'
import { CALIBRATION_TEXT, labelOf } from '../../lib/labels'

/** Every signal by family: what came back, what was expected, and the source's own words. */
export function Signals({ signals }: { readonly signals: readonly Signal[] }) {
  if (signals.length === 0) {
    return <p className="text-ink-soft">No probe produced a signal.</p>
  }
  return (
    <div className="space-y-6">
      {groupSignals(signals).map((group) => (
        <section key={group.family} aria-label={group.name}>
          <h3 className="eyebrow border-b border-ink pb-1">
            {group.name} · {group.signals.length}
          </h3>
          <ol className="divide-y divide-rule">
            {group.signals.map((signal) => (
              <SignalEntry key={`${signal.probeId}/${signal.signalId}`} signal={signal} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function SignalEntry({ signal }: { readonly signal: Signal }) {
  return (
    <li className="space-y-2 py-3">
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 font-mono text-xs text-ink-faint">
        <span>
          {signal.probeId} / {signal.signalId}
        </span>
        <span>{labelOf(CALIBRATION_TEXT, signal.calibration)}</span>
      </p>
      <p>{signal.plainLanguage}</p>
      <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[7rem_1fr]">
        <dt className="eyebrow pt-0.5">Observed</dt>
        <dd className="font-mono break-words">{signal.observed}</dd>
        <dt className="eyebrow pt-0.5">Expected</dt>
        <dd className="break-words">{signal.expected}</dd>
      </dl>
      {signal.citations.length === 0 ? null : (
        <ul className="space-y-2">
          {signal.citations.map((citation) => (
            <CitationEntry key={`${citation.url} ${citation.quote}`} citation={citation} />
          ))}
        </ul>
      )}
    </li>
  )
}

function CitationEntry({ citation }: { readonly citation: Citation }) {
  const href = safeHttpsUrl(citation.url)
  return (
    <li className="border-l-2 border-rule pl-3 text-sm">
      <blockquote className="whitespace-pre-line text-ink-soft">“{citation.quote}”</blockquote>
      <p className="mt-1 font-mono text-xs break-all text-ink-faint">
        {href === undefined ? (
          citation.url
        ) : (
          <a href={href} target="_blank" rel="noreferrer noopener" className="text-link underline">
            {citation.url}
          </a>
        )}{' '}
        · retrieved {citation.retrievedAt}
      </p>
    </li>
  )
}
