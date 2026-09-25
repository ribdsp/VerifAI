import type { CSSProperties, ReactNode } from 'react'

interface SectionProps {
  /** The section mark, `2.1` and so on. */
  readonly mark: string
  readonly title: string
  readonly aside?: ReactNode
  readonly children: ReactNode
  /** Position in the reveal stagger. */
  readonly order?: number
}

/** A numbered section of the record, headed like a clause in a form. */
export function Section({ mark, title, aside, children, order = 0 }: SectionProps) {
  const headingId = `section-${mark.replaceAll('.', '-')}`
  return (
    <section
      aria-labelledby={headingId}
      className="reveal border-t border-ink pt-3 pb-6"
      style={{ '--i': order } as CSSProperties}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id={headingId} className="flex items-baseline gap-3 text-lg font-semibold">
          <span className="font-mono text-sm font-normal text-margin">§{mark}</span>
          {title}
        </h2>
        {aside === undefined ? null : <div className="eyebrow">{aside}</div>}
      </div>
      {children}
    </section>
  )
}
