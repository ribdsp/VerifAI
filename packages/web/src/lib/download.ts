/**
 * Saves a fetched report as a file.
 *
 * The report is fetched with the bearer header rather than linked to, since a
 * link cannot carry a header and a token in a URL would land in history. The
 * object URL lives only for the click that uses it.
 */

import type { ReportFormat } from '@verifai/core'

export interface DownloadDeps {
  readonly createObjectUrl: (blob: Blob) => string
  readonly revokeObjectUrl: (url: string) => void
  /** Clicks a temporary `<a download>`; the default builds one in `document`. */
  readonly click: (url: string, filename: string) => void
  /** Runs a task on a later turn of the event loop. */
  readonly defer: (task: () => void) => void
}

const EXTENSIONS: Readonly<Record<ReportFormat, string>> = Object.freeze({
  json: 'json',
  markdown: 'md',
})

/** `verifai-report-<id>.json`, with anything outside `[A-Za-z0-9_-]` in the id dropped. */
export function reportFilename(checkId: string, format: ReportFormat): string {
  const safe = checkId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'check'
  return `verifai-report-${safe}.${EXTENSIONS[format]}`
}

function clickAnchor(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.hidden = true
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
  }
}

export function browserDownloadDeps(): DownloadDeps {
  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    click: clickAnchor,
    defer: (task) => {
      setTimeout(task, 0)
    },
  }
}

export function saveBlob(blob: Blob, filename: string, deps: DownloadDeps): void {
  const url = deps.createObjectUrl(blob)
  try {
    deps.click(url, filename)
  } finally {
    // Revoked on the next task: the click has started the download by then,
    // and revoking synchronously cancels it in some browsers.
    deps.defer(() => deps.revokeObjectUrl(url))
  }
}
