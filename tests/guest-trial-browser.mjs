// The free trial at /trial, checked in a real browser under phone and desktop conditions. Every /api and external request is
// answered here: no paid provider, database or email is ever reached.
//   BASE_URL=http://localhost:3301 node tests/guest-trial-browser.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {chromium} from 'playwright'

const base = process.env.BASE_URL || 'http://localhost:3301'
const shots = process.env.GUEST_SCREENSHOT_DIR || '/private/tmp/alpa-guest-browser'
await fs.mkdir(shots, {recursive: true})
const IN_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.12.108'
const mk = (i) => ({id: `b-${i}`, company_name: `Fixture Business ${i}`, city: 'Laval', industry: 'Dentist', email: `info@b${i}.ca`, phone: '+1 450 555 0100', website: `https://b${i}.ca`, email_confidence: 'medium', website_intelligence: null, created_at: '2026-10-13T00:00:00Z'})
const leads3 = [1, 2, 3].map(mk)
const leads10 = Array.from({length: 10}, (_, i) => mk(i + 1))
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
const stream = (leads) => ': ping\n\n' + sse([
  {type: 'log', message: '📥 candidate'}, {type: 'log', message: '📦 discovered: 3'},
  {type: 'progress', stage: 'checking', planned: 3, completed: 3, emailsFound: 3, sequence: 1},
  {type: 'progress', stage: 'saving', considered: 3, processed: 3, saved: 3, duplicates: 0, invalid: 0, failed: 0},
  ...leads.map((payload) => ({type: 'lead', payload})), {type: 'result', payload: {summaryLine: `${leads.length} businesses`, discoveredCount: leads.length}},
])
const results = []
const fresh = () => ({leads: [], used: 0, attempts: 0, searching: false})
const after = (leads) => ({leads, used: leads.length, attempts: 1, searching: false})

async function scenario(name, {device = 'phone', hostile = false, session = () => fresh(), scrape, delayMs = 0, fn}) {
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  const context = await browser.newContext(device === 'phone'
    ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, userAgent: IN_APP_UA, deviceScaleFactor: 3, acceptDownloads: true}
    : {viewport: {width: 1280, height: 900}, acceptDownloads: true})
  const page = await context.newPage()
  const telemetry = []
  const state = {scrapeCalls: 0, done: false, calls: 0}
  if (hostile) {
    await context.addInitScript(() => {
      const deny = () => { throw new DOMException('The operation is insecure.', 'SecurityError') }
      Object.defineProperty(window, 'localStorage', {get: deny, configurable: true})
      Object.defineProperty(window, 'sessionStorage', {get: deny, configurable: true})
      try { Object.defineProperty(window.crypto, 'randomUUID', {value: undefined, configurable: true}) } catch {}
    })
  }
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin) return route.abort()
    if (url.pathname === '/api/scrape') {
      state.scrapeCalls += 1
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      return (scrape ?? ((r, s) => { s.done = true; return r.fulfill({contentType: 'text/event-stream', body: stream(leads3)}) }))(route, state)
    }
    if (url.pathname === '/api/guest/session') { state.calls += 1; return route.fulfill({json: session(state.calls, state)}) }
    if (url.pathname === '/api/guest/export') return route.fulfill({contentType: 'text/csv', headers: {'Content-Disposition': 'attachment; filename="alpa-businesses.csv"'}, body: 'a,b\n1,2\n'})
    if (url.pathname === '/api/track') { try { telemetry.push(route.request().postDataJSON()) } catch {} return route.fulfill({json: {}}) }
    if (url.pathname.startsWith('/api/')) return route.fulfill({json: {}})
    return route.continue()
  })
  let ok = true, detail = ''
  try { await fn(page, {telemetry, state, name}) } catch (e) { ok = false; detail = String(e.message).split('\n')[0] }
  await browser.close()
  results.push({name, ok, detail})
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail}`}`)
}

const form = (page) => page.locator('#discover-business-type')
const search = async (page) => {
  await page.locator('#discover-business-type').fill('Dentist')
  await page.locator('#discover-location').fill('Laval')
  await page.getByRole('button', {name: 'Find businesses'}).click()
}
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
const afterSearch = (n, s) => (s.done ? after(leads3) : fresh())

await scenario('landing link opens /trial and a normal search ends on the results (phone)', {
  session: afterSearch,
  fn: async (page, {name}) => {
    await page.goto(base)
    await page.getByRole('link', {name: /Find 25 businesses free/i}).first().click()
    await page.waitForURL('**/trial')
    await form(page).waitFor()
    assert.equal(await page.locator('[role=dialog]').count(), 0, `no modal: ${(await page.locator('[role=dialog]').first().evaluate((n) => n.outerHTML).catch(() => '')).slice(0, 160)}`)
    await search(page)
    await page.waitForURL('**/trial/results', {timeout: 20000})
    await page.locator('article').first().waitFor()
    assert.equal(await page.locator('article').count(), 3, 'three businesses listed')
  },
})

await scenario('direct navigation to /trial: no horizontal scroll, comfortable controls, on a phone', {
  fn: async (page, {name}) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    assert.ok(await noHorizontalScroll(page), 'no horizontal scroll')
    for (const el of await page.locator('main button:visible, main a:visible, main input:visible, header a:visible').all()) {
      const box = await el.boundingBox()
      if (!box) continue
      assert.ok(box.height >= 40, `a control is only ${Math.round(box.height)}px tall: ${(await el.evaluate((n) => n.outerHTML)).slice(0, 140)}`)
    }
    await page.screenshot({path: `${shots}/trial-phone-form.png`})
  },
})

await scenario('direct navigation to /trial on a desktop, and a search to the results', {
  device: 'desktop', session: afterSearch,
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    assert.ok(await noHorizontalScroll(page))
    await page.screenshot({path: `${shots}/trial-desktop-form.png`})
    await search(page)
    await page.waitForURL('**/trial/results', {timeout: 20000})
  },
})

await scenario('while searching, the page shows the real engine for this search and no form (phone)', {
  delayMs: 2500, session: afterSearch,
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await page.getByText(/Laval/).first().waitFor({timeout: 5000})
    assert.equal(await form(page).count(), 0, 'the form gives way to the engine')
    assert.ok(await noHorizontalScroll(page))
    await page.screenshot({path: `${shots}/trial-phone-searching.png`})
    await page.waitForURL('**/trial/results', {timeout: 20000})
  },
})

await scenario('a phone with blocked storage and no crypto.randomUUID can run the whole search', {
  hostile: true, session: afterSearch,
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await page.waitForURL('**/trial/results', {timeout: 20000})
  },
})

await scenario('the connection drops mid-search: it reconnects, waits for the real outcome and opens the businesses', {
  scrape: (route) => route.abort('connectionreset'),
  session: (n) => (n <= 2 ? fresh() : n <= 4 ? {leads: [], used: 3, attempts: 1, searching: true} : after(leads3)),
  fn: async (page, {telemetry}) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await page.getByText(/connection was interrupted/i).waitFor({timeout: 10000})
    await page.screenshot({path: `${shots}/trial-phone-reconnecting.png`})
    await page.waitForURL('**/trial/results', {timeout: 30000})
    assert.ok(telemetry.some((t) => t.event === 'trial_search_failed') && telemetry.some((t) => t.event === 'trial_search_recovered'))
  },
})

await scenario('a request that never reached the server says nothing was used and goes back to the form on "Try again"', {
  scrape: (route) => route.abort('internetdisconnected'),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await page.getByText(/no search ran and nothing was used/i).waitFor({timeout: 20000})
    await page.getByRole('button', {name: 'Try again'}).click()
    await form(page).waitFor()
  },
})

await scenario('refreshing the page during a running search resumes it and ends on the results', {
  session: (n) => (n <= 2 ? {leads: [], used: 3, attempts: 1, searching: true} : after(leads3)),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await page.getByText(/keeps running on ALPA/i).waitFor({timeout: 10000})
    assert.equal(await form(page).count(), 0)
    await page.waitForURL('**/trial/results', {timeout: 30000})
  },
})

await scenario('a returning visitor is welcomed back, offered their businesses first, and can search for more', {
  session: () => after(leads10),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await page.getByRole('heading', {name: 'Welcome back.'}).waitFor()
    await page.getByText('You have 10 businesses saved from your previous search.').waitFor()
    assert.equal(await form(page).count(), 0)
    assert.ok(await noHorizontalScroll(page))
    await page.screenshot({path: `${shots}/trial-phone-welcome-back.png`})
    await page.getByRole('button', {name: 'Find more businesses →'}).click()
    await form(page).waitFor()
    await page.getByText('15 of 25 free businesses left.').waitFor()
    assert.deepEqual(await page.getByRole('button', {pressed: undefined}).evaluateAll((els) => els.map((e) => e.textContent?.trim()).filter((t) => /^(10|15|25)$/.test(t ?? ''))), ['10', '15'])
  },
})

await scenario('"View my businesses" shows the restored list, and a refresh keeps it', {
  session: () => after(leads10),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await page.getByRole('link', {name: 'View my businesses →'}).click()
    await page.waitForURL('**/trial/results')
    await page.locator('article').first().waitFor()
    assert.equal(await page.locator('article').count(), 10)
    await page.reload()
    await page.locator('article').first().waitFor()
    assert.equal(await page.locator('article').count(), 10)
  },
})

await scenario('all free businesses used: a calm state with the way forward, no search form', {
  session: () => ({leads: leads10.concat(leads10.map((l) => ({...l, id: l.id + 'x'})), leads3.map((l) => ({...l, id: l.id + 'y'}))).slice(0, 25), used: 25, attempts: 3, searching: false}),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await page.getByRole('heading', {name: /used your free businesses/i}).waitFor()
    assert.equal(await form(page).count(), 0)
    await page.getByRole('link', {name: 'View my businesses →'}).waitFor()
    await page.getByRole('link', {name: 'Explore ALPA plans →'}).waitFor()
    assert.equal(await page.getByText(/%|discount/i).count(), 0, 'no offer yet')
    await page.screenshot({path: `${shots}/trial-phone-used.png`})
  },
})

await scenario('browser Back from the results returns to a welcome-back page, not an empty form', {
  session: afterSearch,
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await page.waitForURL('**/trial/results', {timeout: 20000})
    await page.goBack()
    await page.waitForURL('**/trial')
    await page.getByRole('heading', {name: 'Welcome back.'}).waitFor({timeout: 10000})
  },
})

await scenario('CSV: an immediate download from the results, then the thank-you', {
  session: () => after(leads3),
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await page.locator('article').first().waitFor()
    const download = page.waitForEvent('download')
    await page.getByRole('link', {name: 'Download CSV', exact: true}).click()
    await download
    await page.getByText('Your businesses are ready.').waitFor()
    await page.getByRole('link', {name: 'Explore ALPA plans →'}).waitFor()
  },
})

await scenario('a shared-network limit is explained as such (not as a used allowance)', {
  scrape: (route) => route.fulfill({status: 429, contentType: 'text/event-stream', body: sse([{type: 'log', message: '❌ x', code: 'GUEST_RATE_LIMITED'}])}),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await page.getByText(/from your network today/i).waitFor({timeout: 10000})
    assert.equal(await page.getByText(/allowance/i).count(), 0)
  },
})

await scenario('an allowance refusal from the server opens the saved businesses, not an error', {
  scrape: (route) => route.fulfill({status: 429, contentType: 'text/event-stream', body: sse([{type: 'log', message: '❌ x', code: 'GUEST_ALLOWANCE_USED'}])}),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await page.getByRole('link', {name: 'View my businesses →'}).waitFor({timeout: 10000})
  },
})

await scenario('a gateway-timeout page is shown as a plain message, never as a parser error', {
  scrape: (route) => route.fulfill({status: 504, contentType: 'text/html', body: '<html><body>An error occurred with your deployment</body></html>'}),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await page.getByText(/took too long to respond/i).waitFor({timeout: 10000})
    assert.equal(await page.getByText(/Unexpected token|JSON/i).count(), 0)
  },
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`)
if (failed.length) process.exit(1)
