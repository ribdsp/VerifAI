import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { openBrowser, type Spawn } from '../src/web/open.js'

const URL = `http://127.0.0.1:43210/#token=${'a1'.repeat(24)}`

interface Spawned {
  readonly command: string
  readonly args: readonly string[]
  readonly options: Readonly<Record<string, unknown>>
}

/** A spawn that records what it was asked to run, then starts or fails as told. */
function fakeSpawn(outcome: 'spawn' | 'error' | 'throw' = 'spawn') {
  const calls: Spawned[] = []
  let unrefs = 0
  const run = (command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options })
    if (outcome === 'throw') {
      throw new Error('spawn EACCES')
    }
    const child = Object.assign(new EventEmitter(), {
      unref: () => {
        unrefs += 1
      },
    })
    queueMicrotask(() =>
      outcome === 'spawn' ? child.emit('spawn') : child.emit('error', new Error('ENOENT')),
    )
    return child
  }
  // The real signature is overloaded past what a fake can state; the calls it makes are one shape.
  return { run: run as unknown as Spawn, calls, unrefs: () => unrefs }
}

describe('openBrowser', () => {
  it('opens the link with start on Windows, quoted and passed verbatim', async () => {
    const spawn = fakeSpawn()
    expect(await openBrowser(URL, 'win32', spawn.run)).toBe(true)
    expect(spawn.calls).toEqual([
      {
        command: 'cmd',
        args: ['/d', '/c', 'start', '""', `"${URL}"`],
        options: expect.objectContaining({
          windowsVerbatimArguments: true,
          detached: true,
          stdio: 'ignore',
        }),
      },
    ])
    expect(spawn.unrefs()).toBe(1)
  })

  it.each([
    ['darwin', 'open'],
    ['linux', 'xdg-open'],
    ['freebsd', 'xdg-open'],
  ] as const)('on %s runs %s with the link as one argument', async (platform, command) => {
    const spawn = fakeSpawn()
    expect(await openBrowser(URL, platform, spawn.run)).toBe(true)
    expect(spawn.calls[0]).toMatchObject({
      command,
      args: [URL],
      options: { windowsVerbatimArguments: false },
    })
  })

  it.each([
    ['another host', URL.replace('127.0.0.1', 'evil.example')],
    ['a token with cmd syntax', `http://127.0.0.1:43210/#token=${'a'.repeat(20)}&calc`],
    ['a quote', `http://127.0.0.1:43210/#token=${'a'.repeat(20)}"`],
    ['https', URL.replace('http:', 'https:')],
    ['a short token', 'http://127.0.0.1:43210/#token=abc'],
  ])('runs nothing for %s', async (_name, url) => {
    const spawn = fakeSpawn()
    expect(await openBrowser(url, 'win32', spawn.run)).toBe(false)
    expect(spawn.calls).toEqual([])
  })

  it('reports false when the opener cannot start', async () => {
    expect(await openBrowser(URL, 'linux', fakeSpawn('error').run)).toBe(false)
    expect(await openBrowser(URL, 'linux', fakeSpawn('throw').run)).toBe(false)
  })
})
