import type { ReactNode } from 'react'

export type NoticeTone = 'fail' | 'caution' | 'info'

const TONES: Readonly<Record<NoticeTone, { box: string; mark: string; label: string }>> = {
  fail: { box: 'border-fail bg-fail-wash text-fail', mark: '✕', label: 'Warning' },
  caution: { box: 'border-caution bg-caution-wash text-caution', mark: '!', label: 'Note' },
  info: { box: 'border-ink-soft bg-rule-soft text-ink', mark: '·', label: 'Note' },
}

interface NoticeProps {
  readonly tone: NoticeTone
  readonly title: string
  readonly children?: ReactNode
  /** `alert` for something that just went wrong; plain otherwise. */
  readonly role?: 'alert' | 'status'
}

/** A boxed remark in the margin of the record. Colour is never its only signal. */
export function Notice({ tone, title, children, role }: NoticeProps) {
  const style = TONES[tone]
  return (
    <div role={role} className={`border-l-4 px-4 py-3 ${style.box}`}>
      <p className="flex items-baseline gap-2 font-semibold">
        <span aria-hidden="true" className="font-mono">
          {style.mark}
        </span>
        <span className="sr-only">{style.label}: </span>
        {title}
      </p>
      {children === undefined ? null : <div className="mt-1 text-ink-soft">{children}</div>}
    </div>
  )
}
