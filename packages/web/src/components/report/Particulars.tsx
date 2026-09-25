import { AUTH_TEXT, type Report } from '@verifai/core'
import { formatCount, formatDuration, groupSkipped, plural } from '../../lib/format'
import { labelOf, PAIRING_LABELS, PROTOCOL_LABELS, VENDOR_LABELS } from '../../lib/labels'
import { DefinitionList, type DefinitionRow } from '../DefinitionList'

/** What was checked: the endpoint by hash, and by name only when the buyer opted in. */
export function TargetParticulars({ report }: { readonly report: Report }) {
  const { target } = report
  const rows: readonly DefinitionRow[] = [
    ['Endpoint hash', target.endpointHash],
    ...(target.endpoint === null ? [] : [['Endpoint', target.endpoint] as const]),
    ['Claimed model', target.claimedModel],
    ...(target.requestedModel === target.claimedModel
      ? []
      : [['Sold as', target.requestedModel] as const]),
    ['Claimed vendor', labelOf(VENDOR_LABELS, target.claimedVendor), false],
    ['Protocol', labelOf(PROTOCOL_LABELS, target.protocol), false],
    ['Pairing', labelOf(PAIRING_LABELS, target.pairing), false],
    ['Key sent as', labelOf(AUTH_TEXT, target.auth), false],
  ]
  return <DefinitionList rows={rows} />
}

/** How the run was made, so a second run can be compared with this one. */
export function RunParticulars({ report }: { readonly report: Report }) {
  const { run, signature } = report
  const rows: readonly DefinitionRow[] = [
    ['Started', run.startedAt],
    ['Finished', run.finishedAt],
    ['Profile', run.profile],
    ['Spread', run.spreadMs === 0 ? 'None' : formatDuration(run.spreadMs)],
    ['Private targets', run.privateTargetsAllowed ? 'Allowed' : 'Refused', false],
    ['Nonce', run.nonce],
    ['Probe order seed', run.probeOrderSeed],
    ['Tool', `${report.tool.name} ${report.tool.version}`],
    ['Fingerprints', report.fingerprintsVersion],
    ['Evidence entries', formatCount(report.evidence.length)],
    [
      'Signature',
      signature === undefined ? 'Unsigned' : `${signature.alg} ${signature.keyFingerprint}`,
    ],
  ]
  return <DefinitionList rows={rows} />
}

/** Probes the run left out, by reason. */
export function SkippedProbes({ report }: { readonly report: Report }) {
  if (report.skipped.length === 0) {
    return <p className="text-sm text-ink-soft">Every planned probe ran.</p>
  }
  return (
    <table className="ledger">
      <caption className="sr-only">{plural(report.skipped.length, 'probe')} left out</caption>
      <thead>
        <tr>
          <th scope="col">Why</th>
          <th scope="col">Probes</th>
        </tr>
      </thead>
      <tbody>
        {groupSkipped(report.skipped).map((row) => (
          <tr key={row.reason}>
            <td>{row.text}</td>
            <td className="font-mono text-xs">{row.probeIds.join(', ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
