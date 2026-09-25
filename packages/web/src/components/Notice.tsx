import type { ReactNode } from 'react'

export type NoticeTone = 'fail' | 'caution' | 'info'

const TONES: Readonly<Record<NoticeTone, { box: string; label: string }>> = {
  fail: { box: 'border-fail bg-fail-wash text-fail', label: 'Warning' },
  caution: { box: 'border-caution bg-caution-wash text-caution', label: 'Note' },
  info: { box: 'border-ink-soft bg-rule-soft text-ink', label: 'Note' },
}

interface NoticeProps {
  readonly tone: NoticeTone
  readonly title: string
  readonly children?: ReactNode
  /** `alert` for something that just went wrong; plain otherwise. */
  readonly role?: 'alert' | 'status'
}

/**
 * A boxed remark in the margin of the record. Colour is never its only signal:
 * the kind of remark is written out beside the title.
 */
export function Notice({ tone, title, children, role }: NoticeProps) {
  const style = TONES[tone]
  return (
    <div role={role} className={`border-l-4 px-4 py-3 ${style.box}`}>
      <p className="flex flex-wrap items-baseline gap-x-3 font-semibold">
        <span className="font-mono text-xs tracking-[0.14em] uppercase">{style.label}</span>
        {title}
      </p>
      {children === undefined ? null : <div className="mt-1 text-ink-soft">{children}</div>}
    </div>
  )
}
