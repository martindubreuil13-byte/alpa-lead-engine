// Phone-condition checks for the guest search, run in a real browser against a dev server. Every /api and external request is
// answered here: no paid provider, database or email is ever reached.
//   BASE_URL=http://localhost:3301 node tests/guest-phase1-browser.mjs
// Set EXPECT=old to run the same checks against a build without the Phase 1 fixes (failures are then reported, not fatal).
import assert from 'node:assert/strict'
import {chromium} from 'playwright'

const base = process.env.BASE_URL || 'http://localhost:3301'
const expectOld = process.env.EXPECT === 'old'
const IN_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.12.108'
const lead = (i) => ({id:`b-${i}`,company_name:`Fixture Business ${i}`,city:'Laval',industry:'Dentist',email:`info@b${i}.ca`,phone:'+1 450 555 0100',website:`https://b${i}.ca`,email_confidence:'medium',website_intelligence:null,created_at:'2026-10-13T00:00:00Z'})
const leads = [1, 2, 3].map(lead)
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
const results = []

async function scenario(name, {hostile = false, scrape, session, fn}) {
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, userAgent: IN_APP_UA, deviceScaleFactor: 3})
  const page = await context.newPage()
  const telemetry = []
  if (hostile) {
    // What a locked-down phone browser does: storage throws on access and crypto.randomUUID does not exist.
    await context.addInitScript(() => {
      const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError') }
      Object.defineProperty(window, 'localStorage', {get: deny, configurable: true})
      Object.defineProperty(window, 'sessionStorage', {get: deny, configurable: true})
      try { Object.defineProperty(window.crypto, 'randomUUID', {value: undefined, configurable: true}) } catch {}
    })
  }
  let sessionCalls = 0
  const state = {scrapeCalls: 0}
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin) return route.abort()
    if (url.pathname === '/api/scrape') { state.scrapeCalls += 1; return scrape(route, state) }
    if (url.pathname === '/api/guest/session') { sessionCalls += 1; return route.fulfill({json: session(sessionCalls, state)}) }
    if (url.pathname === '/api/track') { try { telemetry.push(route.request().postDataJSON()) } catch {} return route.fulfill({json: {}}) }
    if (url.pathname.startsWith('/api/')) return route.fulfill({json: {}})
    return route.continue()
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  let ok = true, detail = ''
  try { await fn(page, {telemetry, state, errors}) } catch (e) { ok = false; detail = String(e.message).split('\n')[0] }
  await browser.close()
  results.push({name, ok, detail})
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail}`}`)
}

const open = async (page, path = '/') => {
  await page.goto(base + path)
  await page.getByRole('link', {name: /Find 25 businesses free/i}).or(page.getByRole('button', {name: /Find 25 businesses free/i})).first().click()
}
const fill = async (page) => {
  await page.locator('#trial-biz').fill('Dentist')
  await page.locator('#trial-loc').fill('Laval')
  await page.getByRole('button', {name: 'Run free lead search', exact: false}).last().click()
}
const okStream = async (route) => route.fulfill({contentType: 'text/event-stream', body: ': ping\n\n' + sse([{type: 'progress', stage: 'saving'}, ...leads.map((payload) => ({type: 'lead', payload})), {type: 'result', payload: {summaryLine: '3 businesses'}}])})
const noSession = () => ({leads: [], used: 0, attempts: 0, searching: false})
const results3 = (attempts = 1) => ({leads, used: 3, attempts, searching: false})

await scenario('control: an ordinary phone runs a normal search to the results page', {
  scrape: okStream, session: noSession,
  fn: async (page) => {
    await open(page)
    await fill(page)
    await page.waitForURL('**/trial/results', {timeout: 15000})
  },
})

await scenario('a phone with blocked storage and no crypto.randomUUID can still open the dialog and run a search', {
  hostile: true, scrape: okStream, session: noSession,
  fn: async (page, {errors}) => {
    await open(page)
    await page.locator('#trial-biz').waitFor({timeout: 5000})
    await fill(page)
    await page.waitForURL('**/trial/results', {timeout: 15000})
  },
})

await scenario('a tap during page load (the ?trial=1 link) opens the dialog and cleans the address', {
  scrape: okStream, session: noSession,
  fn: async (page) => {
    await page.goto(base + '/?trial=1')
    await page.locator('#trial-biz').waitFor({timeout: 10000})
    await page.waitForFunction(() => !location.search.includes('trial=1'), null, {timeout: 3000})
  },
})

await scenario('the connection drops mid-search: the page reconnects, waits for the real outcome and shows the saved businesses', {
  scrape: (route) => route.abort('connectionreset'),
  session: (n) => n <= 2 ? noSession() : n <= 4 ? {leads: [], used: 3, attempts: 1, searching: true} : results3(),
  fn: async (page, {telemetry}) => {
    await open(page)
    await fill(page)
    await page.getByText(/connection was interrupted/i).waitFor({timeout: 10000})
    await page.waitForURL('**/trial/results', {timeout: 30000})
    assert.ok(telemetry.some((t) => t.event === 'trial_search_failed'), 'the failure was reported')
    assert.ok(telemetry.some((t) => t.event === 'trial_search_recovered'), 'the recovery was reported')
  },
})

await scenario('a request that never reached the server says nothing was used and offers a retry', {
  scrape: (route) => route.abort('internetdisconnected'),
  session: () => ({leads: [], used: 0, attempts: 0, searching: false}),
  fn: async (page) => {
    await open(page)
    await fill(page)
    await page.getByText(/no search ran and nothing was used/i).waitFor({timeout: 20000})
    await page.getByRole('button', {name: /Try again/i}).waitFor({timeout: 2000})
  },
})

await scenario('a shared-network limit is explained as such, not as a used allowance', {
  scrape: (route) => route.fulfill({status: 429, contentType: 'text/event-stream', body: sse([{type: 'log', message: '❌ x', code: 'GUEST_RATE_LIMITED'}])}),
  session: noSession,
  fn: async (page) => {
    await open(page)
    await fill(page)
    await page.getByText(/from your network today/i).waitFor({timeout: 10000})
    assert.equal(await page.getByText(/allowance/i).count(), 0)
  },
})

await scenario('an exhausted allowance points to the businesses already saved', {
  scrape: (route) => route.fulfill({status: 429, contentType: 'text/event-stream', body: sse([{type: 'log', message: '❌ x', code: 'GUEST_ALLOWANCE_USED'}])}),
  session: noSession,
  fn: async (page) => {
    await open(page)
    await fill(page)
    await page.getByRole('button', {name: /View my businesses/i}).waitFor({timeout: 10000})
  },
})

await scenario('a gateway timeout page is shown as a plain message, never as a parser error', {
  scrape: (route) => route.fulfill({status: 504, contentType: 'text/html', body: '<html><body>An error occurred with your deployment</body></html>'}),
  session: noSession,
  fn: async (page) => {
    await open(page)
    await fill(page)
    await page.getByText(/took too long to respond/i).waitFor({timeout: 10000})
    assert.equal(await page.getByText(/Unexpected token|JSON/i).count(), 0)
  },
})

await scenario('reloading while a search is still running picks it back up and finishes on the results', {
  scrape: okStream,
  session: (n) => n <= 2 ? {leads: [], used: 3, attempts: 1, searching: true} : results3(),
  fn: async (page) => {
    await page.goto(base)
    await page.getByText(/keeps running on ALPA/i).waitFor({timeout: 10000})
    await page.waitForURL('**/trial/results', {timeout: 30000})
  },
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`)
if (failed.length && !expectOld) process.exit(1)
