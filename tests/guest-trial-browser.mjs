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
const mk = (i) => ({id: `b-${i}`, company_name: `Fixture Business ${i}`, city: 'Laval', industry: 'Dentist', email: `info@b${i}.ca`, phone: '+1 450 555 0100', website: `https://b${i}.ca`, email_confidence: 'medium', website_intelligence: {title: `Dental clinic ${i}`, description: `Family dental care, number ${i}, in Laval.`, headings: ['Teeth whitening', 'Implants'], source_urls: [`https://b${i}.ca/`]}, created_at: '2026-10-13T00:00:00Z'})
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
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
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

const rows = (page) => page.locator('section[aria-label="Businesses"] > ul > li')
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
    await rows(page).first().waitFor()
    assert.equal(await rows(page).count(), 3, 'three businesses listed')
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
    await rows(page).first().waitFor()
    assert.equal(await rows(page).count(), 10)
    await page.reload()
    await rows(page).first().waitFor()
    assert.equal(await rows(page).count(), 10)
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
    await rows(page).first().waitFor()
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


// ------------------------------------------------------------------------------------------------ Phase 3: the workspace
const mixed = [
  {...mk(1), company_name: 'Clinique Laval', city: 'Laval', industry: 'Dentist'},
  {...mk(2), company_name: 'Alpha Smiles', city: 'Brossard', industry: 'Dentist', email: null, website_intelligence: {title: 'Alpha Smiles', description: 'Orthodontics for teens and adults.', headings: ['Braces'], source_urls: ['https://alpha.ca/']}},
  {...mk(3), company_name: 'Zeta Physio', city: 'Montreal', industry: 'Physiotherapy', phone: null, website_intelligence: {title: 'Zeta Physio', description: null, headings: [], source_urls: ['https://zeta.ca/']}},
  {...mk(4), company_name: 'Bare Bones Co', city: 'Laval', industry: 'Services', email: null, phone: null, website: null, website_intelligence: null},
]
const workspace = {session: () => after(mixed)}

await scenario('phone: full-width rows, one tap opens a bottom sheet with who / what / how to reach, and closing returns focus', {
  ...workspace,
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    assert.equal(await rows(page).count(), 4)
    assert.ok(await noHorizontalScroll(page), 'no horizontal scroll')
    await page.screenshot({path: `${shots}/results-phone-list.png`})
    const row = page.getByRole('button', {name: /Clinique Laval/}).first()
    await row.click()
    const sheet = page.getByRole('dialog')
    await sheet.waitFor()
    for (const h of ['Who they are', 'What they do', 'How to reach them']) await sheet.getByRole('heading', {name: h}).waitFor()
    await sheet.getByText('Family dental care, number 1, in Laval.').waitFor()
    await sheet.getByText('From their website').waitFor()
    assert.equal(await sheet.locator('a[href^="mailto:info@b1.ca"]').count(), 1, 'email link')
    assert.equal(await sheet.locator('a[href^="tel:+14505550100"]').count(), 1, 'phone link')
    assert.ok((await sheet.locator('a[href="https://b1.ca/"][target=_blank][rel*=noopener]').count()) >= 1, 'website link (and its source) open safely in a new tab')
    for (const el of await sheet.locator('a:visible, button:visible').all()) {
      const box = await el.boundingBox()
      if (box) assert.ok(box.height >= 40, `a sheet control is only ${Math.round(box.height)}px tall`)
    }
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'the page behind does not scroll')
    assert.ok(await noHorizontalScroll(page))
    await page.screenshot({path: `${shots}/results-phone-sheet.png`})
    await page.keyboard.press('Escape')
    await sheet.waitFor({state: 'detached'})
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes('Clinique Laval')), true, 'focus returns to the row')
    await page.getByRole('button', {name: /Alpha Smiles/}).first().click()
    await page.getByRole('button', {name: 'Close', exact: true}).click()
    await page.getByRole('dialog').waitFor({state: 'detached'})
  },
})

await scenario('desktop: a row opens inline with who / what / how to reach, one at a time', {
  device: 'desktop', ...workspace,
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    await page.getByRole('button', {name: /Clinique Laval/}).first().click()
    const region = page.getByRole('region', {name: /Clinique Laval details/})
    for (const h of ['Who they are', 'What they do', 'How to reach them']) await region.getByRole('heading', {name: h}).waitFor()
    await region.getByText('Family dental care, number 1, in Laval.').waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0, 'no dialog on a desktop')
    await page.screenshot({path: `${shots}/results-desktop-dossier.png`})
    await page.getByRole('button', {name: /Alpha Smiles/}).first().click()
    assert.equal(await page.getByRole('region', {name: /Clinique Laval details/}).count(), 0, 'the first one closed')
    await page.getByRole('region', {name: /Alpha Smiles details/}).getByText('Orthodontics for teens and adults.').waitFor()
  },
})

await scenario('missing contact details and incomplete website intelligence are stated plainly, never filled in', {
  ...workspace,
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    await page.getByRole('button', {name: /Bare Bones Co/}).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByText('This business has no website listed, so there is nothing to read.').waitFor()
    await sheet.getByText('No email address was published on the pages ALPA read.').waitFor()
    await sheet.getByText('No phone number was found.').waitFor()
    await sheet.getByText('No website was found.').waitFor()
    assert.equal(await sheet.locator('a[href^="mailto:"], a[href^="tel:"]').count(), 0)
    await page.keyboard.press('Escape')
    await page.getByRole('button', {name: /Zeta Physio/}).first().click()
    await page.getByRole('dialog').getByText(/Their website is titled “Zeta Physio”\./).waitFor()
    assert.equal(await page.getByRole('dialog').getByText('From their website').count(), 0, 'no attribution without a description')
  },
})

await scenario('search, filter and sort the businesses on the page, and clear them', {
  device: 'desktop', ...workspace,
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    const names = async () => (await rows(page).locator('button[aria-haspopup], button[aria-expanded]').filter({hasText: /\S/}).allTextContents()).length
    const search = page.getByRole('searchbox')
    await search.fill('orthodontics')
    await page.getByText('1 of 4 businesses').waitFor()
    assert.equal(await rows(page).count(), 1)
    await search.fill('')
    await page.getByText('4 businesses', {exact: true}).waitFor()
    await page.getByRole('button', {name: 'Email', exact: true}).click()
    await page.getByText('2 of 4 businesses').waitFor()
    await page.getByRole('button', {name: 'Phone', exact: true}).click()
    await page.getByText('1 of 4 businesses').waitFor()
    await page.getByRole('button', {name: 'Clear filters'}).click()
    await page.getByText('4 businesses', {exact: true}).waitFor()
    await page.getByPlaceholder('City', {exact: true}).fill('laval')
    await page.getByText('2 of 4 businesses').waitFor()
    await page.getByRole('button', {name: 'Clear filters'}).click()
    await page.getByLabel('Sort').selectOption('name')
    await page.waitForFunction(() => document.querySelector('section[aria-label="Businesses"] > ul > li button')?.textContent?.includes('Alpha Smiles'))
    await page.getByLabel('Sort').selectOption('location')
    await page.waitForFunction(() => document.querySelector('section[aria-label="Businesses"] > ul > li button')?.textContent?.includes('Alpha Smiles'))
    await search.fill('zzzz-no-match')
    await page.getByText('No businesses match these filters').waitFor()
    await page.getByRole('button', {name: 'Clear filters'}).first().click()
    assert.equal(await rows(page).count(), 4)
  },
})

await scenario('phone: filters and the overview shortcuts work with 16px fields and large controls, with no zoom-inducing text', {
  ...workspace,
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    for (const el of await page.locator('input[type=search]:visible, input:not([type]):visible, select:visible').all()) {
      assert.ok(Number.parseFloat(await el.evaluate((n) => getComputedStyle(n).fontSize)) >= 16, 'fields are 16px or larger on a phone')
      assert.ok((await el.boundingBox()).height >= 40)
    }
    assert.equal(await page.getByPlaceholder('City', {exact: true}).isVisible(), false, 'city and industry start tucked away on a phone')
    await page.getByText(/4 businesses · 2 with email · 2 with phone · 3 with website/).waitFor()
    await page.getByRole('button', {name: 'Email', exact: true}).click()
    await page.getByText('2 of 4 businesses').waitFor()
    assert.equal(await page.getByRole('button', {name: 'Email', exact: true}).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', {name: 'More filters'}).click()
    const city = page.getByPlaceholder('City', {exact: true})
    await city.waitFor()
    assert.ok(Number.parseFloat(await city.evaluate((n) => getComputedStyle(n).fontSize)) >= 16)
    await city.fill('laval')
    await page.getByText('1 of 4 businesses').waitFor()
    await page.screenshot({path: `${shots}/results-phone-filtered.png`})
  },
})

await scenario('CSV and the account link: the download is one tap, the thank-you follows, signup stays quiet but reachable', {
  ...workspace,
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    const link = page.getByRole('link', {name: /Download CSV/})
    assert.ok((await link.boundingBox()).height >= 44)
    const download = page.waitForEvent('download')
    await link.click()
    await download
    await page.getByText('Thanks for giving ALPA a try. Now go start some conversations.').waitFor()
    await page.screenshot({path: `${shots}/results-phone-thanks.png`})
    const signup = page.getByRole('link', {name: 'Create a free account'})
    await signup.waitFor()
    assert.match(await signup.getAttribute('href'), /\/login\?mode=signup/)
    assert.equal(await page.locator('input[type=email], input[type=password], [role=dialog]').count(), 0)
  },
})

await scenario('an empty trial and a failed load are both calm and recoverable', {
  session: () => fresh(),
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await page.getByText('No businesses yet').waitFor()
    await page.getByRole('link', {name: 'Find businesses'}).waitFor()
  },
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`)
if (failed.length) process.exit(1)
