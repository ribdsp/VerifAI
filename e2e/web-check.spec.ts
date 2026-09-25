import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import { type Daemon, startDaemon } from './daemon.js'
import { type FakeUpstream, startFakeUpstream } from './fake-upstream.js'

/**
 * A check from the web UI, as a buyer runs one: the form, the estimate, the
 * run, the report and its copies. Beside the flow, what the daemon promises
 * about the key and the session: the key leaves the page once the estimate is
 * ready and is in no copy of the report, the token leaves the address bar, and
 * the page will not load in a frame.
 */

// Built, not written: a key-shaped literal would trip the secret scan.
const API_KEY = ['e2e', 'loopback', 'only', 'key'].join('-')
const MODEL = 'claude-opus-5-5'
/** A quick check against loopback takes seconds; this is headroom for a slow runner. */
const RUN_MS = 60_000

let daemon: Daemon
let upstream: FakeUpstream

// Each handle is kept as soon as it is up, so a failure to start the other
// still leaves afterAll something to stop.
test.beforeAll(async () => {
  await Promise.all([
    startDaemon().then((started) => {
      daemon = started
    }),
    startFakeUpstream().then((started) => {
      upstream = started
    }),
  ])
})

test.afterAll(async () => {
  await Promise.all([daemon?.stop(), upstream?.close()])
})

/** The key is nowhere the page keeps anything: its markup, its fields, its storage, its address. */
async function expectKeyGone(page: Page): Promise<void> {
  expect(await page.content()).not.toContain(API_KEY)
  for (const field of await page.locator('input, textarea').all()) {
    expect(await field.inputValue()).not.toContain(API_KEY)
  }
  const stored = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
  )
  expect(stored).not.toContain(API_KEY)
  expect(page.url()).not.toContain(API_KEY)
}

test('serves the page unframeable, and takes the token out of the address bar', async ({
  page,
}) => {
  const response = await page.goto(daemon.link)

  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
  await expect(page.getByLabel(/Endpoint URL$/)).toBeVisible()
  expect(page.url()).not.toContain('token')
})

test('says the daemon is out of reach when the page has no token', async ({ page }) => {
  await page.goto(daemon.origin)

  await expect(page.getByText('The local daemon is not available')).toBeVisible()
  await expect(page.getByLabel(/Endpoint URL$/)).toHaveCount(0)
})

test('runs a check from the form to the report, and keeps the key out of both', async ({
  page,
}) => {
  test.setTimeout(RUN_MS * 2)
  await page.goto(daemon.link)

  await page.getByLabel(/Endpoint URL$/).fill(upstream.baseUrl)
  await page.getByLabel(/API key$/).fill(API_KEY)
  await page.getByLabel(/Model$/).fill(MODEL)
  await page.getByLabel(/Protocol$/).selectOption('anthropic-messages')
  await page.locator('#profile-quick').check()
  await page.getByText('Override the profile’s budget, or allow private addresses').click()
  await page.getByLabel('Allow private and loopback addresses').check()
  await page.getByRole('button', { name: 'Prepare estimate' }).click()

  await expect(page.getByRole('heading', { name: /Estimate/ })).toBeVisible()
  await expect(page.getByText('Nothing has been sent yet')).toBeVisible()
  await expect(page.getByText(/cross the network unencrypted/)).toBeVisible()
  expect(upstream.keysSeen()).toEqual([])
  await expectKeyGone(page)

  await page.getByRole('button', { name: 'Start the check' }).click()

  await expect(page.getByRole('heading', { name: /Five axes/ })).toBeVisible({ timeout: RUN_MS })
  await expect(page.locator('#verdict-heading')).toBeVisible()
  const keys = upstream.keysSeen()
  expect(keys.length).toBeGreaterThan(0)
  expect(new Set(keys)).toEqual(new Set([API_KEY]))
  await expectKeyGone(page)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download JSON' }).click()
  const copy = await readFile(await (await download).path(), 'utf8')
  expect(JSON.parse(copy)).toMatchObject({
    target: { claimedModel: MODEL, protocol: 'anthropic-messages', endpoint: null },
  })
  expect(copy).not.toContain(API_KEY)
  // Left unticked, the endpoint is named by its hash alone.
  expect(copy).not.toContain(new URL(upstream.baseUrl).host)

  await page.getByRole('button', { name: 'New check' }).click()
  await expect(page.getByLabel(/API key$/)).toHaveValue('')
})
