import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
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

/** Fills the form for a check of the loopback fake, the private-address opt-in ticked. */
async function fillForm(page: Page, profile: 'quick' | 'standard'): Promise<void> {
  await page.getByLabel(/Endpoint URL$/).fill(upstream.baseUrl)
  await page.getByLabel(/API key$/).fill(API_KEY)
  await page.getByLabel(/Model$/).fill(MODEL)
  await page.getByLabel(/Protocol$/).selectOption('anthropic-messages')
  await page.locator(`#profile-${profile}`).check()
  await page.getByText('Override the profile’s budget, or allow private addresses').click()
  await page.getByLabel('Allow private and loopback addresses').check()
}

/** What in the page reaches past the right edge of the screen, by tag and text. */
async function widerThanScreen(page: Page): Promise<readonly string[]> {
  const edge = await page.locator('html').evaluate((html) => html.clientWidth)
  return page
    .locator('main *')
    .evaluateAll(
      (elements, limit) =>
        elements
          .filter((element) => element.getBoundingClientRect().right > limit + 0.5)
          .map((element) => `${element.tagName} ${(element.textContent ?? '').slice(0, 40)}`),
      edge,
    )
}

/**
 * How far, in pixels, the verdict stamp reaches past its coloured box. The box
 * sits inside the page's margins, so a stamp can spill out of it and still be
 * on the screen.
 */
async function stampOverhang(page: Page): Promise<number> {
  return page.locator('.stamp').evaluate(async (stamp) => {
    // Measured at rest, not while the stamp is still landing at a larger scale.
    // The landing plays once, so the wait ends; a looping animation would hold it.
    const animations: readonly { readonly finished: Promise<unknown> }[] = stamp.getAnimations()
    await Promise.all(animations.map((animation) => animation.finished))
    const box = stamp.closest('section')?.getBoundingClientRect()
    if (box === undefined) {
      throw new Error('The stamp is not inside the verdict section.')
    }
    const own = stamp.getBoundingClientRect()
    return Math.max(0, own.right - box.right, box.left - own.left)
  })
}

/** Each disclosure draws its own ▸, so the browser's marker must not draw a second. */
async function expectOneMarkerEach(page: Page): Promise<void> {
  const summaries = await page.locator('summary').all()
  expect(summaries.length).toBeGreaterThan(0)
  for (const summary of summaries) {
    await expect(summary).toHaveCSS('list-style-type', 'none')
  }
}

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

  await fillForm(page, 'quick')
  await expectOneMarkerEach(page)
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

test('puts the cursor on the endpoint when the daemon refuses it', async ({ page }) => {
  await page.goto(daemon.link)

  // Loopback, without the per-run opt-in.
  await page.getByLabel(/Endpoint URL$/).fill(upstream.baseUrl)
  await page.getByLabel(/Model$/).fill(MODEL)
  await page.getByRole('button', { name: 'Prepare estimate' }).click()

  const endpoint = page.getByLabel(/Endpoint URL$/)
  await expect(endpoint).toHaveAttribute('aria-invalid', 'true')
  await expect(endpoint).toBeFocused()
})

test('puts the cursor on the protocol when none can be told apart', async ({ page }) => {
  // Every path is absent, so detection has nothing to go on.
  const absent = createServer((_request, response) => {
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => absent.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = absent.address() as AddressInfo
    await page.goto(daemon.link)
    await page.getByLabel(/Endpoint URL$/).fill(`http://127.0.0.1:${port}/v1`)
    await page.getByLabel(/Model$/).fill(MODEL)
    await page.getByText('Override the profile’s budget, or allow private addresses').click()
    await page.getByLabel('Allow private and loopback addresses').check()
    await page.getByRole('button', { name: 'Prepare estimate' }).click()

    const protocol = page.getByLabel(/Protocol$/)
    await expect(protocol).toHaveAttribute('aria-invalid', 'true')
    await expect(protocol).toBeFocused()
  } finally {
    absent.closeAllConnections()
    await new Promise((done) => absent.close(done))
  }
})

// The narrowest phone screen in common use, and a common one wide enough for the larger stamp.
for (const viewport of [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
]) {
  test.describe(`on a phone ${viewport.width} pixels wide`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true })

    test('fits the estimate and the report to the screen', async ({ page }) => {
      test.setTimeout(RUN_MS * 2)
      await page.goto(daemon.link)

      await fillForm(page, 'standard')
      await page.getByRole('button', { name: 'Prepare estimate' }).click()
      await expect(page.getByRole('heading', { name: /Estimate/ })).toBeVisible()
      expect(await widerThanScreen(page)).toEqual([])

      await page.getByRole('button', { name: 'Start the check' }).click()
      await expect(page.getByRole('heading', { name: /Routing dilution/ })).toBeVisible({
        timeout: RUN_MS,
      })
      expect(await widerThanScreen(page)).toEqual([])
      expect(await stampOverhang(page)).toBeLessThan(1)
      // The evidence carries nonces and header values with no place to break.
      await page.getByText('Every signal, with what was expected').click()
      expect(await widerThanScreen(page)).toEqual([])
      await expectOneMarkerEach(page)
      // The figure is named in words, so the capitals the aside is set in cannot misread it.
      await expect(
        page.getByRole('region', { name: 'Routing dilution' }).locator('.eyebrow').first(),
      ).toHaveText(/^Disagreement rate /i, { useInnerText: true })
    })
  })
}
