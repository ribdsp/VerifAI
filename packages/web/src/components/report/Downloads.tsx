import type { ReportFormat } from '@verifai/core'
import { useState } from 'react'
import { type ApiClient, messageOf } from '../../lib/api'
import { browserDownloadDeps, reportFilename, saveBlob } from '../../lib/download'
import { Notice } from '../Notice'

const FORMATS: readonly { readonly format: ReportFormat; readonly label: string }[] = [
  { format: 'json', label: 'Download JSON' },
  { format: 'markdown', label: 'Download Markdown' },
]

interface DownloadsProps {
  readonly client: ApiClient
  readonly checkId: string
}

/** The report as the daemon rendered it, byte for byte, never re-rendered here. */
export function Downloads({ client, checkId }: DownloadsProps) {
  const [pending, setPending] = useState<ReportFormat | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  async function download(format: ReportFormat) {
    setPending(format)
    setProblem(undefined)
    try {
      const blob = await client.download(checkId, format)
      saveBlob(blob, reportFilename(checkId, format), browserDownloadDeps())
    } catch (error) {
      setProblem(messageOf(error))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {FORMATS.map(({ format, label }) => (
          <button
            key={format}
            type="button"
            className="button button-quiet"
            onClick={() => download(format)}
            disabled={pending !== undefined}
          >
            {pending === format ? 'Fetching…' : label}
          </button>
        ))}
        <p className="text-sm text-ink-faint">The files hold no API key.</p>
      </div>
      {problem === undefined ? null : (
        <Notice tone="fail" title="The report was not downloaded" role="alert">
          {problem}
        </Notice>
      )}
    </div>
  )
}
