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

async function scenario(name, {device = 'phone', hostile = false, session = () => fresh(), scrape, delayMs = 0, feedback = {}, profile, fn}) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  const context = await browser.newContext(device === 'phone'
    ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, userAgent: IN_APP_UA, deviceScaleFactor: 3, acceptDownloads: true}
    : {viewport: {width: 1280, height: 900}, acceptDownloads: true})
  const page = await context.newPage()
  const telemetry = []
  const state = {scrapeCalls: 0, done: false, calls: 0}
  const fb = {stored: null, fail: false, status: 503, posts: [], ...feedback}
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
    if (url.pathname === '/api/guest/feedback') {
      if (route.request().method() === 'GET') return route.fulfill({json: {feedback: fb.stored}})
      const body = route.request().postDataJSON()
      fb.posts.push(body)
      if (fb.fail) return route.fulfill({status: fb.status, json: {error: fb.status === 410 ? 'This trial has expired.' : 'Your feedback could not be saved right now.'}})
      fb.stored = {answer: body.answer, hasComment: Boolean(body.comment) || Boolean(fb.stored?.hasComment)}
      return route.fulfill({json: {ok: true, feedback: fb.stored}})
    }
    if (url.pathname === '/api/guest/profile') {
      state.profileCalls = (state.profileCalls ?? 0) + 1
      state.profileBody = route.request().postDataJSON()
      return (profile ?? ((r) => r.fulfill({status: 503, json: {code: 'unavailable'}})))(route, state)
    }
    if (url.pathname === '/api/guest/export') return route.fulfill({contentType: 'text/csv', headers: {'Content-Disposition': 'attachment; filename="alpa-businesses.csv"'}, body: 'a,b\n1,2\n'})
    if (url.pathname === '/api/track') { try { telemetry.push(route.request().postDataJSON()) } catch {} return route.fulfill({json: {}}) }
    if (url.pathname.startsWith('/api/')) return route.fulfill({json: {}})
    return route.continue()
  })
  let ok = true, detail = ''
  try { await fn(page, {telemetry, state, name, fb}) } catch (e) { ok = false; detail = String(e.message).split('\n')[0] }
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
    await page.getByText("You've discovered 10 businesses. You have 15 free businesses remaining.").waitFor()
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

const upgradeHeading = (page) => page.getByRole('heading', {name: "You've discovered your 25 free businesses."})
const many = (n) => Array.from({length: n}, (_, i) => mk(i + 1))
const returning = (n, attempts = 1) => ({session: () => ({leads: many(n), used: n, attempts, searching: false})})

await scenario('guest with 0 businesses: the search form, no conversion anything', {
  ...returning(0, 0),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    assert.equal(await upgradeHeading(page).count(), 0); assert.equal(await page.getByText(/50% off/).count(), 0)
    await page.getByText('25 free businesses. No account, email or card.').waitFor()
  },
})

await scenario('guest with 10 businesses: welcomed back, still discovering normally, never pitched', {
  ...returning(10),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await page.getByRole('heading', {name: 'Welcome back.'}).waitFor()
    assert.equal(await upgradeHeading(page).count(), 0); assert.equal(await page.getByText(/50% off/).count(), 0)
    await page.getByRole('button', {name: 'Find more businesses →'}).click()
    await form(page).waitFor()
    await page.getByText("You've discovered 10 businesses. You have 15 free businesses remaining.").waitFor()
  },
})

await scenario('guest with 24 businesses: one left, still a search form, no offer', {
  ...returning(24, 2),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await page.getByRole('heading', {name: 'Welcome back.'}).waitFor()
    await page.getByText("You've discovered 24 businesses. You have 1 free business remaining.").first().waitFor()
    await page.getByRole('button', {name: 'Find my last business →'}).click()
    await form(page).waitFor()
    await page.getByRole('button', {name: 'Find my last business →'}).waitFor()
    assert.equal(await page.getByRole('button', {name: /^(10|25)$/}).count(), 0, 'no minimum of 10 when one is left')
    assert.equal(await upgradeHeading(page).count(), 0); assert.equal(await page.getByText(/50% off/).count(), 0)
  },
})

await scenario('guest with 24 businesses asks for the last one: the request is for exactly one business', {
  ...returning(24, 2),
  scrape: (route, state) => { state.body = route.request().postDataJSON(); state.done = true; return route.fulfill({contentType: 'text/event-stream', body: stream([mk(25)])}) },
  fn: async (page, {state}) => {
    await page.goto(base + '/trial')
    await page.getByRole('button', {name: 'Find my last business →'}).click()
    await form(page).waitFor()
    await page.getByLabel('Business type').fill('dentists')
    await page.getByLabel('Location').fill('Laval')
    await page.getByRole('button', {name: 'Find my last business →'}).click()
    await page.waitForURL('**/trial/results', {timeout: 30000})
    assert.equal(state.body.maxLeads, 1)
    assert.equal(state.body.outputLeadLimit, 1)
  },
})

await scenario('guest with 5 left: only 5 is offered, with no minimum of 10', {
  ...returning(20, 2),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await page.getByText("You've discovered 20 businesses. You have 5 free businesses remaining.").first().waitFor()
    await page.getByRole('button', {name: 'Find more businesses →'}).click()
    await form(page).waitFor()
    assert.equal(await page.getByRole('button', {name: '5', exact: true}).count(), 1)
    assert.equal(await page.getByRole('button', {name: '10', exact: true}).count(), 0)
  },
})

await scenario('guest with 25 businesses: the upgrade moment, offer previewed and not promised, no form, no pop-up (phone)', {
  ...returning(25, 2),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await upgradeHeading(page).waitFor()
    await page.getByText('Ready to find more?').waitFor()
    await page.getByText('Enjoy 50% off your first month of ALPA when you upgrade.').waitFor()
    await page.getByText('The discount applies to your first month only. Regular pricing resumes afterward.').waitFor()
    await page.getByText(/not active yet, so nothing is discounted today/).waitFor()
    await page.getByText(/Upcoming offer · not active yet/).waitFor()
    assert.equal(await page.getByRole('link', {name: 'Explore ALPA plans →'}).getAttribute('href'), '/plans')
    assert.equal(await page.getByRole('link', {name: 'View my businesses →'}).getAttribute('href'), '/trial/results')
    assert.equal(await form(page).count(), 0, 'no search form that would lead to an error')
    assert.equal(await page.getByRole('dialog').count(), 0, 'no pop-up')
    assert.equal(await page.getByText(/countdown|hurry|limited time|expires|last chance/i).count(), 0)
    assert.equal(await page.locator('input[type=email]').count(), 0)
    assert.ok(await noHorizontalScroll(page))
    for (const link of [page.getByRole('link', {name: 'Explore ALPA plans →'}), page.getByRole('link', {name: 'View my businesses →'})]) assert.ok((await link.boundingBox()).height >= 44)
    await page.screenshot({path: `${shots}/trial-phone-upgrade.png`})
  },
})

await scenario('guest with 25 businesses on a desktop', {
  device: 'desktop', ...returning(25, 2),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await upgradeHeading(page).waitFor()
    await page.screenshot({path: `${shots}/trial-desktop-upgrade.png`})
  },
})

await scenario('guest who used the 3 free searches before reaching 25: a truthful headline and the same offer', {
  ...returning(12, 3),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await page.getByRole('heading', {name: "You've used your three free searches."}).waitFor()
    await page.getByText('You discovered 12 businesses across them, before reaching your 25. Ready to find more?').waitFor()
    await page.getByText('Enjoy 50% off your first month of ALPA when you upgrade.').waitFor()
    assert.equal(await upgradeHeading(page).count(), 0, 'it does not claim 25 when there are 12')
  },
})

await scenario('a returning guest (restored from the server record) at 25 sees the upgrade moment after a refresh too', {
  ...returning(25, 2),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await upgradeHeading(page).waitFor()
    await page.reload()
    await upgradeHeading(page).waitFor()
    await page.getByRole('link', {name: 'View my businesses →'}).click()
    await page.waitForURL('**/trial/results')
    await rows(page).first().waitFor()
    assert.equal(await page.getByText(/50% off/).count(), 0, 'the businesses page itself carries no discount')
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

await scenario('a search refused because the allowance is used shows the upgrade moment, not an error', {
  scrape: (route) => route.fulfill({status: 429, contentType: 'text/event-stream', body: sse([{type: 'log', message: '❌ x', code: 'GUEST_ALLOWANCE_USED'}])}),
  session: (n) => (n <= 2 ? fresh() : {leads: many(25), used: 25, attempts: 2, searching: false}),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await form(page).waitFor()
    await search(page)
    await upgradeHeading(page).waitFor({timeout: 10000})
    await page.getByRole('link', {name: 'View my businesses →'}).waitFor()
    assert.equal(await page.getByText(/something went wrong|error/i).count(), 0)
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
    assert.equal(await page.getByText(/50%|discount|% off/i).count(), 0, 'the download moment carries no discount: that is reserved for asking for more')
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


// ------------------------------------------------------------------------------------------------------ Phase 6: feedback
const QUESTION = 'Did ALPA find what you were looking for?'
const question = (page) => page.getByRole('heading', {name: QUESTION})
const openFirst = async (page) => { await page.getByRole('button', {name: /Clinique Laval/}).first().click() }

await scenario('the question is not there at first, and appears quietly after the visitor opens a business (phone)', {
  ...workspace,
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    assert.equal(await question(page).count(), 0, 'not shown before the visitor has explored')
    await openFirst(page)
    await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    await question(page).waitFor()
    assert.equal(await page.getByRole('dialog').count(), 0, 'it did not open anything by itself')
    for (const name of ['Yes', 'Partly', 'Not really']) assert.ok((await page.getByRole('button', {name, exact: true}).boundingBox()).height >= 44)
    assert.ok(await noHorizontalScroll(page))
    await page.screenshot({path: `${shots}/feedback-phone-question.png`})
  },
})

await scenario('it also appears after filtering or downloading, and after a short while with no interaction', {
  device: 'desktop', ...workspace,
  fn: async (page) => {
    await page.clock.install()
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    assert.equal(await question(page).count(), 0)
    await page.clock.fastForward(16_000)
    await question(page).waitFor()
  },
})

await scenario('Yes: the thank-you, nothing else; no field, no redirect, no plans pitch, one request', {
  device: 'desktop', ...workspace,
  fn: async (page, {fb}) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    await openFirst(page)
    await question(page).waitFor()
    const before = await page.getByRole('link', {name: /plans/i}).count()
    await page.getByRole('button', {name: 'Yes', exact: true}).click()
    await page.getByText('Glad ALPA helped. Good luck turning those businesses into customers.').waitFor()
    assert.equal(await page.getByRole('textbox').count() > 0 ? await page.locator('#feedback-comment').count() : 0, 0, 'no comment field for Yes')
    assert.equal(await page.getByRole('link', {name: /plans/i}).count(), before, 'answering adds no plans link and no offer')
    assert.equal(await page.getByText(/50%|discount|upgrade/i).count(), 0)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.ok(page.url().endsWith('/trial/results'))
    assert.equal(fb.posts.length, 1)
    assert.equal(fb.posts[0].answer, 'yes'); assert.equal(fb.posts[0].downloaded, false)
    assert.deepEqual(Object.keys(fb.posts[0]).sort(), ['analyticsSessionId', 'answer', 'downloaded'], 'nothing personal is sent')
  },
})

await scenario('Partly and Not really: an optional comment, saved separately, without email or account (phone)', {
  ...workspace,
  fn: async (page, {fb}) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    await openFirst(page); await page.keyboard.press('Escape')
    await question(page).waitFor()
    await page.getByRole('button', {name: 'Partly', exact: true}).click()
    const box = page.getByLabel('What could ALPA have done better?')
    await box.waitFor()
    assert.ok(Number.parseFloat(await box.evaluate((n) => getComputedStyle(n).fontSize)) >= 16, '16px so iOS does not zoom')
    assert.equal(await page.locator('input[type=email]').count(), 0)
    await page.getByText('Optional. No email or account needed.').waitFor()
    assert.equal(fb.posts.length, 1, 'the answer is saved before any comment')
    await page.screenshot({path: `${shots}/feedback-phone-comment.png`})
    await box.fill('Too many without an email address.')
    await page.getByRole('button', {name: 'Send', exact: true}).click()
    await page.getByText('Thank you. That helps us improve.').waitFor()
    assert.deepEqual([fb.posts.length, fb.posts[1].answer, fb.posts[1].comment], [2, 'partly', 'Too many without an email address.'])
    assert.ok(await noHorizontalScroll(page))
  },
})

await scenario('Not really works the same, and changing the answer to Yes replaces the comment box with the thank-you', {
  device: 'desktop', ...workspace,
  fn: async (page, {fb}) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    await openFirst(page); await question(page).waitFor()
    await page.getByRole('button', {name: 'Not really', exact: true}).click()
    await page.getByLabel('What could ALPA have done better?').waitFor()
    assert.equal(await page.getByRole('button', {name: 'Send', exact: true}).isDisabled(), true, 'nothing to send until something is typed')
    await page.getByRole('button', {name: 'Yes', exact: true}).click()
    await page.getByText('Glad ALPA helped.').waitFor()
    assert.equal(await page.locator('#feedback-comment').count(), 0)
    assert.deepEqual(fb.posts.map((p) => p.answer), ['not_really', 'yes'])
  },
})

await scenario('a refresh remembers the answer and does not ask again; a comment already sent is not asked for twice', {
  device: 'desktop', ...workspace, feedback: {stored: {answer: 'partly', hasComment: true}},
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await question(page).waitFor({timeout: 10000})
    assert.equal(await page.getByRole('button', {name: 'Partly', exact: true}).getAttribute('aria-pressed'), 'true')
    await page.getByText('Thank you. That helps us improve.').waitFor()
    assert.equal(await page.locator('#feedback-comment').count(), 0)
    await page.reload()
    await question(page).waitFor({timeout: 10000})
    await page.getByText('Thank you. That helps us improve.').waitFor()
  },
})

await scenario('a stored Yes shows the thank-you again after a refresh', {
  device: 'desktop', ...workspace, feedback: {stored: {answer: 'yes', hasComment: false}},
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await page.getByText('Glad ALPA helped. Good luck turning those businesses into customers.').waitFor({timeout: 10000})
  },
})

await scenario('a failed save says so plainly, keeps the question usable, and succeeds on the next try', {
  device: 'desktop', ...workspace, feedback: {fail: true},
  fn: async (page, {fb}) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    await openFirst(page); await question(page).waitFor()
    await page.getByRole('button', {name: 'Yes', exact: true}).click()
    await page.getByRole('alert').getByText('Your feedback could not be saved right now.').waitFor()
    assert.equal(await page.getByText('Glad ALPA helped.').count(), 0, 'no thank-you for something that was not saved')
    fb.fail = false
    await page.getByRole('button', {name: 'Yes', exact: true}).click()
    await page.getByText('Glad ALPA helped.').waitFor()
  },
})

await scenario('an expired trial is told so by the server and the page carries on', {
  device: 'desktop', ...workspace, feedback: {fail: true, status: 410},
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    await openFirst(page); await question(page).waitFor()
    await page.getByRole('button', {name: 'Partly', exact: true}).click()
    await page.getByRole('alert').getByText('This trial has expired.').waitFor()
    assert.equal(await rows(page).count(), 4, 'the businesses are still there')
  },
})

await scenario('feedback never blocks the CSV: the download works with the question open, and the answer notes it', {
  device: 'desktop', ...workspace,
  fn: async (page, {fb}) => {
    await page.goto(base + '/trial/results')
    await rows(page).first().waitFor()
    await openFirst(page); await question(page).waitFor()
    await page.getByRole('button', {name: 'Partly', exact: true}).click()
    await page.getByLabel('What could ALPA have done better?').waitFor()
    const download = page.waitForEvent('download')
    await page.getByRole('link', {name: /Download CSV/}).click()
    await download
    await page.getByText('Thanks for giving ALPA a try. Now go start some conversations.').waitFor()
    assert.equal(await page.getByText(/50%|discount/i).count(), 0)
    await page.getByLabel('What could ALPA have done better?').fill('More phone numbers please')
    await page.getByRole('button', {name: 'Send', exact: true}).click()
    await page.getByText('Thank you. That helps us improve.').waitFor()
    assert.equal(fb.posts.at(-1).downloaded, true)
  },
})

await scenario('no businesses, no question; and the search and upgrade pages never show it', {
  session: () => fresh(),
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await page.getByText('No businesses yet').waitFor()
    assert.equal(await question(page).count(), 0)
    await page.goto(base + '/trial')
    await form(page).waitFor()
    assert.equal(await question(page).count(), 0)
  },
})

await scenario('the allowance-exhausted upgrade moment stays separate: no question there', {
  ...returning(25, 2),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await upgradeHeading(page).waitFor()
    assert.equal(await question(page).count(), 0)
  },
})

// ---- Phase 7: a short profile when a business is opened
const richFacts = {title: 'Clinique Laval | Family dental care', description: 'Family dental care in Laval: teeth whitening, dental implants, orthodontics and emergency dentistry for children and adults.', headings: ['Teeth whitening', 'Dental implants', 'Orthodontics', 'Emergency dentistry'], source_urls: ['https://b1.ca/']}
const richLead = {...mk(1), website_intelligence: richFacts}
const saved = {version: 1, summary: 'Clinique Laval is a family dental clinic in Laval. According to its website, it offers teeth whitening, dental implants, orthodontics and emergency dentistry for both children and adults.', tags: ['Teeth whitening', 'Dental implants', 'Orthodontics'], generated_at: '2026-10-14T00:00:00Z', model: 'gpt-4o-mini'}
const profileReply = (delay) => async (route) => { await new Promise((r) => setTimeout(r, delay)); return route.fulfill({json: {profile: saved, cached: false}}) }

await scenario('phone: opening a business shows a quiet loading line, then a short profile with service tags, inside the sheet', {
  session: () => after([richLead]),
  profile: profileReply(900),
  fn: async (page, {state}) => {
    await page.goto(base + '/trial/results')
    await page.getByRole('button', {name: /Fixture Business 1/}).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByText('Writing a short summary…').waitFor()
    assert.equal(await sheet.getByText('Family dental care in Laval: teeth whitening').count(), 1, "the website's own words stay visible while it loads")
    await sheet.getByText(/is a family dental clinic in Laval/).waitFor()
    await sheet.getByText('Written by AI from their website. Not independently verified.').waitFor()
    for (const tag of ['Teeth whitening', 'Dental implants', 'Orthodontics']) await sheet.getByRole('list', {name: 'Services'}).getByText(tag).waitFor()
    assert.equal(await sheet.getByText('Writing a short summary…').count(), 0)
    for (const h of ['Who they are', 'What they do', 'How to reach them']) await sheet.getByRole('heading', {name: h}).waitFor()
    assert.equal(state.profileCalls, 1); assert.equal(state.profileBody.leadId, 'b-1')
    assert.ok(await noHorizontalScroll(page))
    await page.screenshot({path: `${shots}/results-phone-profile.png`})
    await page.getByRole('button', {name: /close/i}).first().click().catch(() => {})
  },
})

await scenario('phone: a failed profile says so quietly, keeps the website words, and the next open tries again', {
  session: () => after([richLead]),
  profile: (route) => route.fulfill({status: 502, json: {code: 'failed'}}),
  fn: async (page, {state}) => {
    await page.goto(base + '/trial/results')
    await page.getByRole('button', {name: /Fixture Business 1/}).first().click()
    const sheet = page.getByRole('dialog')
    await sheet.getByText(/short summary couldn't be written just now/).waitFor()
    assert.equal(await sheet.getByRole('alert').count(), 0, 'not an alarm')
    await sheet.getByText('Family dental care in Laval: teeth whitening').waitFor()
    assert.equal(state.profileCalls, 1)
  },
})

await scenario('a business with too little website text asks for no profile and shows no loading line', {
  session: () => after([mk(1)]),
  fn: async (page, {state}) => {
    await page.goto(base + '/trial/results')
    await page.getByRole('button', {name: /Fixture Business 1/}).first().click()
    await page.getByRole('dialog').getByText('Family dental care, number 1, in Laval.').waitFor()
    assert.equal(await page.getByText('Writing a short summary…').count(), 0)
    assert.equal(state.profileCalls ?? 0, 0)
  },
})

await scenario('a saved profile is shown at once after a refresh, without asking again', {
  session: () => after([{...richLead, light_profile: saved}]),
  fn: async (page, {state}) => {
    await page.goto(base + '/trial/results')
    await page.reload()
    await page.getByRole('button', {name: /Fixture Business 1/}).first().click()
    await page.getByRole('dialog').getByText(/is a family dental clinic in Laval/).waitFor()
    assert.equal(state.profileCalls ?? 0, 0)
  },
})

await scenario('desktop: the profile appears inside the open row, keeping Who / What / How', {
  device: 'desktop',
  session: () => after([richLead]),
  profile: profileReply(100),
  fn: async (page) => {
    await page.goto(base + '/trial/results')
    await page.getByRole('button', {name: /Fixture Business 1/}).first().click()
    await page.getByText(/is a family dental clinic in Laval/).waitFor()
    await page.getByRole('list', {name: 'Services'}).getByText('Dental implants').waitFor()
    await page.screenshot({path: `${shots}/results-desktop-profile.png`})
  },
})

await scenario('while a search runs, the third stage reads "Ready to explore", not "Available separately"', {
  scrape: (route) => new Promise(() => {}),
  fn: async (page) => {
    await page.goto(base + '/trial')
    await search(page)
    await page.getByText('Ready to explore').first().waitFor()
    assert.equal(await page.getByText('Available separately').count(), 0)
  },
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`)
if (failed.length) process.exit(1)
