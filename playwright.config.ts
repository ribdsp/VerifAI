import { defineConfig, devices } from '@playwright/test'

/**
 * The web UI end to end: the built `verifai web` against a fake endpoint on
 * loopback, driven by a real browser. The specs start
 * `packages/cli/dist/bin.js`, so run `pnpm run build` first, then
 * `pnpm run test:e2e`. One worker: each spec file starts its own daemon, and
 * a daemon runs one check at a time.
 */
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['github']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
