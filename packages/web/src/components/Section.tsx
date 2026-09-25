import { type CSSProperties, type ReactNode, useId } from 'react'

interface SectionProps {
  readonly title: string
  readonly aside?: ReactNode
  readonly children: ReactNode
  /** Position in the reveal stagger. */
  readonly order?: number
}

/** A section of the record, headed by its title and ruled off from the one before. */
export function Section({ title, aside, children, order = 0 }: SectionProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className="reveal border-t border-ink pt-3 pb-6"
      style={{ '--i': order } as CSSProperties}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        {aside === undefined ? null : <div className="eyebrow">{aside}</div>}
      </div>
      {children}
    </section>
  )
}
