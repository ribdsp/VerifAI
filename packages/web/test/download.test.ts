import { describe, expect, it } from 'vitest'
import { type DownloadDeps, reportFilename, saveBlob } from '../src/lib/download'

function recordingDeps(click: DownloadDeps['click'] = () => {}) {
  const steps: string[] = []
  const deferred: (() => void)[] = []
  const deps: DownloadDeps = {
    createObjectUrl: () => {
      steps.push('create')
      return 'blob:local/1'
    },
    click: (url, filename) => {
      steps.push(`click ${url} ${filename}`)
      click(url, filename)
    },
    revokeObjectUrl: (url) => steps.push(`revoke ${url}`),
    defer: (task) => {
      steps.push('defer')
      deferred.push(task)
    },
  }
  const runDeferred = () => {
    for (const task of deferred.splice(0)) {
      task()
    }
  }
  return { deps, steps, runDeferred }
}

describe('reportFilename', () => {
  it('names the file by check and format', () => {
    expect(reportFilename('chk_01-a', 'json')).toBe('verifai-report-chk_01-a.json')
    expect(reportFilename('chk_01-a', 'markdown')).toBe('verifai-report-chk_01-a.md')
  })

  it('drops anything from the id that could escape a filename', () => {
    expect(reportFilename('../../etc/passwd', 'json')).toBe('verifai-report-etcpasswd.json')
    expect(reportFilename('a b\\c:d*?"<>|', 'json')).toBe('verifai-report-abcd.json')
    expect(reportFilename('../', 'json')).toBe('verifai-report-check.json')
    expect(reportFilename('x'.repeat(200), 'json')).toBe(`verifai-report-${'x'.repeat(64)}.json`)
  })
})

describe('saveBlob', () => {
  it('clicks the object URL, then revokes it on a later task', () => {
    const { deps, steps, runDeferred } = recordingDeps()

    saveBlob(new Blob(['{}']), 'verifai-report-x.json', deps)

    expect(steps).toEqual(['create', 'click blob:local/1 verifai-report-x.json', 'defer'])
    runDeferred()
    expect(steps.at(-1)).toBe('revoke blob:local/1')
  })

  it('still revokes the URL when the click throws', () => {
    const { deps, steps, runDeferred } = recordingDeps(() => {
      throw new Error('blocked')
    })

    expect(() => saveBlob(new Blob(['{}']), 'f.json', deps)).toThrow('blocked')
    runDeferred()

    expect(steps.at(-1)).toBe('revoke blob:local/1')
  })
})
