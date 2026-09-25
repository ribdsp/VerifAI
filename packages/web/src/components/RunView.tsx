import type { CheckEvent, CreateCheckResponse } from '@verifai/core'
import { useEffect, useEffectEvent, useState } from 'react'
import { type ApiClient, messageOf } from '../lib/api'
import { describeEvent, type EventLine, formatCount, shareOf } from '../lib/format'
import { initialRunState, pollCheck, type RunState } from '../lib/poll'
import { DrawStrip } from './DrawStrip'
import { Meter } from './Meter'
import { Notice } from './Notice'
import { Section } from './Section'

interface RunViewProps {
  readonly client: ApiClient
  readonly created: CreateCheckResponse
  /** The profile's Group F draws, when Group F is planned. */
  readonly plannedDraws: number | undefined
  readonly onFinal: (state: RunState) => void
}

const TONE_MARKS: Readonly<Record<EventLine['tone'], { mark: string; className: string }>> = {
  info: { mark: '', className: 'text-ink-faint' },
  ok: { mark: '✓', className: 'text-pass' },
  warn: { mark: '!', className: 'text-caution' },
  bad: { mark: '✕', className: 'text-fail' },
}

export function RunView({ client, created, plannedDraws, onFinal }: RunViewProps) {
  const { checkId, estimate } = created
  const [run, setRun] = useState(() => initialRunState(checkId, estimate.probes.length))
  const [pollProblem, setPollProblem] = useState<string | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelProblem, setCancelProblem] = useState<string | undefined>(undefined)
  const reportFinal = useEffectEvent((state: RunState) => onFinal(state))
  const resumeFrom = useEffectEvent(() => run)

  useEffect(() => {
    const controller = new AbortController()
    // `attempt` restarts the poller from where it stopped after a failure.
    const from = attempt === 0 ? initialRunState(checkId, estimate.probes.length) : resumeFrom()
    pollCheck(client, from, { signal: controller.signal, onUpdate: setRun })
      .then((state) => {
        if (!controller.signal.aborted) {
          reportFinal(state)
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPollProblem(messageOf(error))
        }
      })
    return () => controller.abort()
  }, [client, checkId, estimate.probes.length, attempt])

  async function cancel() {
    setIsCancelling(true)
    setCancelProblem(undefined)
    try {
      await client.cancelCheck(checkId)
    } catch (error) {
      setCancelProblem(messageOf(error))
      setIsCancelling(false)
    }
  }

  function retry() {
    setPollProblem(undefined)
    setAttempt((count) => count + 1)
  }

  const { progress } = run
  const total = Math.max(progress.total, 1)
  const hasGroupF = plannedDraws !== undefined || run.draws.length > 0 || run.drawsTaken > 0

  return (
    <div className="space-y-2">
      <Section
        title="Running"
        aside={
          <>
            Check <span className="normal-case">{checkId}</span>
          </>
        }
        order={0}
      >
        <div className="space-y-3">
          <div
            role="progressbar"
            aria-label="Probes done"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.min(progress.done, total)}
            className="relative h-5 border border-ink bg-sheet"
          >
            <div
              className="hatch h-full text-ink transition-[width] duration-300"
              style={{ width: `${shareOf(progress.done, total) * 100}%` }}
            />
          </div>
          <p aria-live="polite" className="font-mono text-sm">
            {formatCount(progress.done)} of {formatCount(progress.total)} probes done
          </p>
          <Meter
            label="Requests"
            value={progress.requests}
            max={estimate.maxRequests}
            text={`${formatCount(progress.requests)} of ${formatCount(estimate.maxRequests)}`}
          />
          <Meter
            label="Tokens"
            value={progress.tokens}
            max={estimate.maxTokens}
            text={`${formatCount(progress.tokens)} of ${formatCount(estimate.maxTokens)}`}
          />
        </div>
      </Section>

      {hasGroupF ? (
        <Section title="Routing-dilution draws" aside="Group F" order={1}>
          <DrawStrip
            draws={run.draws}
            taken={run.drawsTaken}
            {...(plannedDraws === undefined ? {} : { planned: plannedDraws })}
          />
        </Section>
      ) : null}

      <Section title="Log" aside="Newest first" order={2}>
        <EventLog events={run.log} />
      </Section>

      <div className="reveal flex flex-wrap items-center gap-4 border-t border-ink pt-4">
        <button
          type="button"
          className="button button-quiet"
          onClick={cancel}
          disabled={isCancelling}
        >
          {isCancelling ? 'Cancelling…' : 'Cancel the check'}
        </button>
        <p className="text-sm text-ink-faint">
          Cancelling stops at the next request. Nothing already sent is recalled.
        </p>
      </div>
      {cancelProblem === undefined ? null : (
        <Notice tone="fail" title="The check was not cancelled" role="alert">
          {cancelProblem}
        </Notice>
      )}
      {pollProblem === undefined ? null : (
        <Notice tone="fail" title="Lost track of the check" role="alert">
          <p>{pollProblem}</p>
          <button type="button" className="button button-quiet mt-2" onClick={retry}>
            Try again
          </button>
        </Notice>
      )}
    </div>
  )
}

function EventLog({ events }: { readonly events: readonly CheckEvent[] }) {
  if (events.length === 0) {
    return <p className="font-mono text-sm text-ink-faint">Waiting for the first probe…</p>
  }
  return (
    <section
      aria-label="Event log"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard.
      tabIndex={0}
      className="max-h-80 overflow-y-auto border border-rule bg-sheet"
    >
      <ol className="divide-y divide-rule-soft font-mono text-xs">
        {[...events].reverse().map(({ seq, event }) => {
          const line = describeEvent(event)
          const tone = TONE_MARKS[line.tone]
          return (
            <li key={seq} className="grid grid-cols-[3.5rem_1rem_1fr] gap-2 px-3 py-1">
              <span className="text-right text-ink-faint">{seq}</span>
              <span aria-hidden="true" className={tone.className}>
                {tone.mark}
              </span>
              <span className="break-words">{line.text}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
