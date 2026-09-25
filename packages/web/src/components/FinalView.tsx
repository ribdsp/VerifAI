import type { ApiError, CheckState } from '@verifai/core'
import { Notice } from './Notice'
import { Section } from './Section'

type EndedState = Exclude<CheckState, 'prepared' | 'running' | 'finished'>

interface FinalViewProps {
  readonly state: EndedState
  readonly error: ApiError | undefined
  readonly onRestart: () => void
}

const ENDINGS: Readonly<
  Record<EndedState, { title: string; text: string; tone: 'fail' | 'caution' | 'info' }>
> = {
  stopped: {
    title: 'The endpoint stopped the check',
    text: 'The endpoint rejected the key or the model, or could not be reached. No report was issued, and nothing was concluded about the endpoint.',
    tone: 'caution',
  },
  failed: {
    title: 'VerifAI failed',
    text: 'Something went wrong inside VerifAI, not at the endpoint. No report was issued.',
    tone: 'fail',
  },
  cancelled: {
    title: 'The check was cancelled',
    text: 'No report was issued.',
    tone: 'info',
  },
}

export function isEndedState(state: CheckState): state is EndedState {
  return state === 'stopped' || state === 'failed' || state === 'cancelled'
}

/** A check that ended without a report: what happened, in the daemon's words. */
export function FinalView({ state, error, onRestart }: FinalViewProps) {
  const ending = ENDINGS[state]
  return (
    <Section mark="8" title="No report" aside={state} order={0}>
      <div className="space-y-4">
        <Notice tone={ending.tone} title={ending.title} role="status">
          <p>{ending.text}</p>
          {error === undefined ? null : (
            <p className="mt-2 font-mono text-sm">
              <span className="text-ink-faint">{error.code}: </span>
              {error.message}
            </p>
          )}
        </Notice>
        <button type="button" className="button button-primary" onClick={onRestart}>
          New check
        </button>
      </div>
    </Section>
  )
}
