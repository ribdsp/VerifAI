export type Step = 'form' | 'estimate' | 'running' | 'done'

const STEPS: readonly { readonly step: Step; readonly label: string }[] = [
  { step: 'form', label: 'Particulars' },
  { step: 'estimate', label: 'Estimate' },
  { step: 'running', label: 'Run' },
  { step: 'done', label: 'Record' },
]

interface MastheadProps {
  readonly step: Step | undefined
  readonly version: string | undefined
}

/** The head of the record: what this page is, and how far the check has got. */
export function Masthead({ step, version }: MastheadProps) {
  const current = STEPS.findIndex((entry) => entry.step === step)
  return (
    <header className="border-b-2 border-ink pb-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="eyebrow">Local audit · this machine only</p>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            VerifAI <span className="font-normal text-ink-soft">· Endpoint audit record</span>
          </h1>
        </div>
        <p className="font-mono text-xs text-ink-faint">
          {version === undefined ? 'daemon not reached' : `daemon ${version}`}
        </p>
      </div>
      <p aria-live="polite" className="sr-only">
        {current === -1 ? '' : `Step ${current + 1} of ${STEPS.length}: ${STEPS[current]?.label}`}
      </p>
      {step === undefined ? null : (
        <nav aria-label="Progress" className="mt-4">
          <ol className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs tracking-wide uppercase">
            {STEPS.map((entry, index) => {
              const isCurrent = index === current
              const isPast = index < current
              return (
                <li
                  key={entry.step}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={
                    isCurrent
                      ? 'border-b-2 border-margin text-ink'
                      : isPast
                        ? 'text-ink-soft'
                        : 'text-ink-faint'
                  }
                >
                  <span aria-hidden="true">{isPast ? '✓' : `${index + 1}.`}</span> {entry.label}
                </li>
              )
            })}
          </ol>
        </nav>
      )}
    </header>
  )
}
