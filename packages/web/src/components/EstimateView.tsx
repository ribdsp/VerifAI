import { AUTH_TEXT, type CheckEstimate, type CreateCheckResponse } from '@verifai/core'
import { useState } from 'react'
import { type ApiClient, messageOf } from '../lib/api'
import { formatCount, groupProbes, groupSkipped, plural } from '../lib/format'
import { labelOf, PAIRING_LABELS, PROTOCOL_LABELS, VENDOR_LABELS, warningText } from '../lib/labels'
import { Meter } from './Meter'
import { Notice } from './Notice'
import { Section } from './Section'

interface EstimateViewProps {
  readonly client: ApiClient
  readonly created: CreateCheckResponse
  readonly onStarted: () => void
  /** Back to the form, whether or not the daemon confirmed the cancel. */
  readonly onCancelled: () => void
}

type Pending = 'start' | 'cancel' | undefined

export function EstimateView({ client, created, onStarted, onCancelled }: EstimateViewProps) {
  const { checkId, estimate } = created
  const [pending, setPending] = useState<Pending>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  async function start() {
    setPending('start')
    setProblem(undefined)
    try {
      await client.startCheck(checkId)
      onStarted()
    } catch (error) {
      setProblem(messageOf(error))
      setPending(undefined)
    }
  }

  async function cancel() {
    setPending('cancel')
    try {
      await client.cancelCheck(checkId)
    } catch {
      // The daemon forgets an unstarted check on its own; leaving is still right.
    }
    onCancelled()
  }

  const warnings = estimate.warnings.map((code) => ({ code, ...warningText(code) }))
  const prominent = warnings.filter((warning) => warning.prominent)
  const other = warnings.filter((warning) => !warning.prominent)

  return (
    <div className="space-y-2">
      {prominent.length === 0 ? null : (
        <div className="reveal space-y-2 pb-4">
          {prominent.map((warning) => (
            <Notice key={warning.code} tone="fail" title={warning.title}>
              {warning.text}
            </Notice>
          ))}
        </div>
      )}

      <Section mark="4" title="Estimate" aside="Nothing has been sent yet" order={0}>
        <Particulars estimate={estimate} />
        <div className="mt-4 space-y-2">
          <Meter
            label="Requests"
            value={estimate.requests}
            max={estimate.maxRequests}
            text={`${formatCount(estimate.requests)} of ${formatCount(estimate.maxRequests)}`}
          />
          <Meter
            label="Tokens"
            value={estimate.tokens}
            max={estimate.maxTokens}
            text={`${formatCount(estimate.tokens)} of ${formatCount(estimate.maxTokens)}`}
          />
        </div>
        <p className="mt-2 text-sm text-ink-faint">
          Upper bounds. A probe that finds what it needs early stops early.
        </p>
      </Section>

      <Section
        mark="5"
        title="Probes planned"
        aside={plural(estimate.probes.length, 'probe')}
        order={1}
      >
        <PlannedTable estimate={estimate} />
      </Section>

      {estimate.skipped.length === 0 ? null : (
        <Section
          mark="6"
          title="Probes left out"
          aside={plural(estimate.skipped.length, 'probe')}
          order={2}
        >
          <SkippedTable estimate={estimate} />
        </Section>
      )}

      {other.length === 0 ? null : (
        <Section mark="7" title="Notes" order={3}>
          <ul className="space-y-2">
            {other.map((warning) => (
              <li key={warning.code}>
                <Notice tone="caution" title={warning.title}>
                  {warning.text}
                </Notice>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="reveal flex flex-wrap items-center gap-4 border-t border-ink pt-4">
        <button
          type="button"
          className="button button-primary"
          onClick={start}
          disabled={pending !== undefined}
        >
          {pending === 'start' ? 'Starting…' : 'Start the check'}
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={cancel}
          disabled={pending !== undefined}
        >
          {pending === 'cancel' ? 'Cancelling…' : 'Cancel'}
        </button>
        <p className="text-sm text-ink-faint">Starting sends requests to the endpoint.</p>
      </div>
      {problem === undefined ? null : (
        <Notice tone="fail" title="The check did not start" role="alert">
          {problem}
        </Notice>
      )}
    </div>
  )
}

function Particulars({ estimate }: { readonly estimate: CheckEstimate }) {
  const rows: readonly (readonly [string, string])[] = [
    ['Protocol', labelOf(PROTOCOL_LABELS, estimate.protocol)],
    ['Vendor', labelOf(VENDOR_LABELS, estimate.vendor)],
    ['Pairing', labelOf(PAIRING_LABELS, estimate.pairing)],
    ['Key sent as', labelOf(AUTH_TEXT, estimate.auth)],
    ['Profile', estimate.profile],
  ]
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="eyebrow pt-0.5">{term}</dt>
          <dd className="font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function PlannedTable({ estimate }: { readonly estimate: CheckEstimate }) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th scope="col" className="w-12">
            Group
          </th>
          <th scope="col">What it tests</th>
          <th scope="col">Probes</th>
        </tr>
      </thead>
      <tbody>
        {groupProbes(estimate.probes).map((row) => (
          <tr key={row.group}>
            <th scope="row" className="font-mono text-base">
              {row.group}
            </th>
            <td>{row.name}</td>
            <td>
              <ul className="space-y-0.5">
                {row.probes.map((probe) => (
                  <li key={probe.id}>
                    <span className="font-mono text-xs text-ink-faint">{probe.id}</span>{' '}
                    {probe.title}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SkippedTable({ estimate }: { readonly estimate: CheckEstimate }) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th scope="col">Why</th>
          <th scope="col">Probes</th>
        </tr>
      </thead>
      <tbody>
        {groupSkipped(estimate.skipped).map((row) => (
          <tr key={row.reason}>
            <td>{row.text}</td>
            <td className="font-mono text-xs">{row.probeIds.join(', ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
