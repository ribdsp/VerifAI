/**
 * Opening the page in the buyer's browser.
 *
 * The URL goes to the platform's opener as a single argument and never
 * through a shell's parsing - except on Windows, where `start` is a `cmd`
 * built-in. That is why the URL is checked first against the one shape this
 * daemon prints: loopback, a port, and a token of [a-z0-9], with no character
 * `cmd` would treat as syntax.
 */

import { spawn } from 'node:child_process'

const DAEMON_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\/#token=[a-z0-9]{16,256}$/

interface Opener {
  readonly command: string
  readonly args: readonly string[]
}

function openerFor(platform: NodeJS.Platform, url: string): Opener {
  switch (platform) {
    case 'win32':
      // `/d` skips AutoRun. The empty argument is `start`'s window title, so the quoted URL
      // after it is taken as what to open rather than as a title.
      return { command: 'cmd', args: ['/d', '/c', 'start', '""', `"${url}"`] }
    case 'darwin':
      return { command: 'open', args: [url] }
    default:
      return { command: 'xdg-open', args: [url] }
  }
}

export type Spawn = typeof spawn

/** Resolves `false` for a URL of any other shape, or when no opener could be started. */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  run: Spawn = spawn,
): Promise<boolean> {
  if (!DAEMON_URL.test(url)) {
    return Promise.resolve(false)
  }
  const { command, args } = openerFor(platform, url)
  return new Promise((resolve) => {
    try {
      const child = run(command, [...args], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        windowsVerbatimArguments: platform === 'win32',
      })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}
