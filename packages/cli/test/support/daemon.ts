/**
 * A real daemon on a free loopback port, closed after each test, serving a
 * two-file page and running checks against a transport the test holds.
 */

import type { Transport } from '@verifai/core'
import { afterEach } from 'vitest'
import { fakeTransport, jsonResponse } from '../../../core/test/fakes/transport.js'
import type { Asset, Assets } from '../../src/daemon/assets.js'
import { type Daemon, type DaemonOptions, startDaemon } from '../../src/daemon/server.js'
import { CATALOGUE } from './context.js'

const encoder = new TextEncoder()

export const PAGE = '<!doctype html><title>VerifAI</title>'
export const SCRIPT_PATH = '/assets/index-abc123.js'

export const ASSETS: Assets = new Map<string, Asset>([
  ['/index.html', Object.freeze({ type: 'text/html; charset=utf-8', body: encoder.encode(PAGE) })],
  [
    SCRIPT_PATH,
    Object.freeze({ type: 'text/javascript; charset=utf-8', body: encoder.encode('export {}') }),
  ],
])

const running: Daemon[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((daemon) => daemon.close()))
})

export async function daemon(options: Partial<DaemonOptions> = {}): Promise<Daemon> {
  const transport: Transport = fakeTransport(() => jsonResponse(200, { ok: true }))
  const started = await startDaemon({
    port: 0,
    assets: ASSETS,
    allowPrivateTargets: false,
    createTransport: () => transport,
    version: '0.0.0',
    checkEnvironment: { catalogue: CATALOGUE },
    ...options,
  })
  running.push(started)
  return started
}
