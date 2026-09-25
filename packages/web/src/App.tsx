import type { CreateCheckResponse, HealthResponse, OptionsResponse } from '@verifai/core'
import { useEffect, useState } from 'react'
import { CheckForm } from './components/CheckForm'
import { ErrorBoundary } from './components/ErrorBoundary'
import { EstimateView } from './components/EstimateView'
import { FinalView, isEndedState } from './components/FinalView'
import { Masthead, type Step } from './components/Masthead'
import { Notice } from './components/Notice'
import { ReportView } from './components/ReportView'
import { RunView } from './components/RunView'
import { Downloads } from './components/report/Downloads'
import { type ApiClient, messageOf } from './lib/api'
import type { RunState } from './lib/poll'
import { type CheckFormValues, initialFormValues } from './lib/request'

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'form' }
  | { readonly kind: 'estimate'; readonly created: CreateCheckResponse }
  | { readonly kind: 'running'; readonly created: CreateCheckResponse }
  | { readonly kind: 'done'; readonly created: CreateCheckResponse; readonly run: RunState }

interface Daemon {
  readonly health: HealthResponse
  readonly options: OptionsResponse
}

interface AppProps {
  readonly client: ApiClient
  /** Whether the page was opened with a session token in its fragment. */
  readonly hasSession: boolean
}

const NO_SESSION =
  'This page was opened without its session link. Run verifai web in a terminal and open the link it prints. A reload drops the session on purpose.'

function stepOf(phase: Phase): Step | undefined {
  return phase.kind === 'loading' || phase.kind === 'unavailable' ? undefined : phase.kind
}

/** Group F's planned draws, when Group F is in the plan. */
function plannedDrawsOf(created: CreateCheckResponse): number | undefined {
  return created.estimate.draws > 0 ? created.estimate.draws : undefined
}

export function App({ client, hasSession }: AppProps) {
  const [phase, setPhase] = useState<Phase>(
    hasSession ? { kind: 'loading' } : { kind: 'unavailable', message: NO_SESSION },
  )
  const [daemon, setDaemon] = useState<Daemon | undefined>(undefined)
  // Everything the form holds except the API key, kept across checks.
  const [values, setValues] = useState<CheckFormValues | undefined>(undefined)

  useEffect(() => {
    if (!hasSession) {
      return
    }
    const controller = new AbortController()
    Promise.all([client.health(controller.signal), client.options(controller.signal)])
      .then(([health, options]) => {
        setDaemon({ health, options })
        setValues(initialFormValues(options))
        setPhase({ kind: 'form' })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPhase({ kind: 'unavailable', message: messageOf(error) })
        }
      })
    return () => controller.abort()
  }, [client, hasSession])

  const restart = () => setPhase({ kind: 'form' })

  return (
    <div className="mx-auto max-w-5xl px-3 py-6 sm:px-6 sm:py-10">
      <main className="sheet py-6 pr-4 pl-12 sm:py-10 sm:pr-10 sm:pl-16">
        <Masthead step={stepOf(phase)} version={daemon?.health.version} />
        <div className="pt-6">
          {phase.kind === 'loading' ? (
            <p role="status" className="font-mono text-sm text-ink-faint">
              Reaching the local daemon…
            </p>
          ) : null}
          {phase.kind === 'unavailable' ? (
            <Notice tone="fail" title="The local daemon is not available" role="alert">
              {phase.message}
            </Notice>
          ) : null}
          {phase.kind === 'form' && daemon !== undefined && values !== undefined ? (
            <CheckForm
              client={client}
              options={daemon.options}
              values={values}
              onValuesChange={setValues}
              onCreated={(created) => setPhase({ kind: 'estimate', created })}
            />
          ) : null}
          {phase.kind === 'estimate' ? (
            <EstimateView
              client={client}
              created={phase.created}
              onStarted={() => setPhase({ kind: 'running', created: phase.created })}
              onCancelled={restart}
            />
          ) : null}
          {phase.kind === 'running' && daemon !== undefined ? (
            <RunView
              key={phase.created.checkId}
              client={client}
              created={phase.created}
              plannedDraws={plannedDrawsOf(phase.created)}
              onFinal={(run) => setPhase({ kind: 'done', created: phase.created, run })}
            />
          ) : null}
          {phase.kind === 'done' ? (
            <Outcome client={client} run={phase.run} onRestart={restart} />
          ) : null}
        </div>
      </main>
      <p className="mt-4 text-center font-mono text-xs text-ink-faint">
        Served by the VerifAI daemon on this machine. An API key typed here stays in this tab’s
        memory and is sent once, to the daemon.
      </p>
    </div>
  )
}

interface OutcomeProps {
  readonly client: ApiClient
  readonly run: RunState
  readonly onRestart: () => void
}

function Outcome({ client, run, onRestart }: OutcomeProps) {
  if (isEndedState(run.state)) {
    return <FinalView state={run.state} error={run.error} onRestart={onRestart} />
  }
  if (run.report === undefined) {
    return (
      <Notice tone="fail" title="The check finished without a report" role="alert">
        <p>The daemon reported the check finished, then sent no report.</p>
        <button type="button" className="button button-quiet mt-2" onClick={onRestart}>
          New check
        </button>
      </Notice>
    )
  }
  const fallback = (
    <div className="space-y-4">
      <Notice tone="fail" title="This page could not show the report" role="alert">
        <p>The report is intact on the daemon. Download it to read it in full.</p>
      </Notice>
      <Downloads client={client} checkId={run.checkId} />
    </div>
  )
  return (
    <ErrorBoundary fallback={fallback}>
      <ReportView client={client} checkId={run.checkId} report={run.report} onRestart={onRestart} />
    </ErrorBoundary>
  )
}
