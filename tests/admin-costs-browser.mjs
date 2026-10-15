// The Cost intelligence page in a real browser, phone and desktop, against a fake sign-in service. Every /api request is answered
// here from the real report builder; no database, provider or Stripe is reached.
//   node tests/admin-costs-browser.mjs        (starts its own dev server on :3304 and the stub on :3399)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {buildCostReport} from '../lib/costs/report.ts'
import {buildReconciliationView, parsePurchaseInput, parseReconciliationInput} from '../lib/costs/reconcile.ts'

const SUPA = 'http://localhost:3399'
const base = 'http://localhost:3304'
const shots = process.env.COSTS_SCREENSHOT_DIR || '/private/tmp/alpa-costs-browser'
fs.mkdirSync(shots, {recursive: true})
const USER = {id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'owner@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'}
let PLAN = 'admin'
const cors = {'Access-Control-Expose-Headers': 'Content-Range', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json'}
const profile = () => ({plan: PLAN, stripe_customer_id: null, stripe_subscription_id: null, subscription_status: 'active', plan_status: 'active', cancel_at_period_end: false, current_period_end: '2027-01-01T00:00:00Z', canceled_at: null, subscription_tier: PLAN, email: USER.email, id: USER.id})
const stub = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  const object = String(req.headers.accept || '').includes('vnd.pgrst.object')
  if (req.url.startsWith('/auth/v1/user')) { res.writeHead(200, cors); return res.end(JSON.stringify(USER)) }
  if (req.method === 'HEAD') { res.writeHead(200, {...cors, 'Content-Range': '*/0'}); return res.end() }
  if (req.url.startsWith('/rest/v1/users')) { res.writeHead(200, cors); return res.end(JSON.stringify(object ? {id: USER.id, email: USER.email, plan: PLAN} : [{id: USER.id, email: USER.email, plan: PLAN}])) }
  if (req.url.startsWith('/rest/v1/usage')) { res.writeHead(200, cors); const row = {leads_used: 0, leads_limit: 500, period_start: '2026-10-01T00:00:00Z', period_end: '2026-11-01T00:00:00Z'}; return res.end(JSON.stringify(object ? row : [row])) }
  if (req.url.startsWith('/rest/v1/profiles')) { res.writeHead(200, cors); return res.end(JSON.stringify(object ? profile() : [profile()])) }
  if (object) { res.writeHead(406, cors); return res.end(JSON.stringify({code: 'PGRST116', message: 'no rows', details: '', hint: ''})) }
  res.writeHead(200, cors); res.end('[]')
}).listen(3399)
const log = fs.openSync('/tmp/costs-dev.log', 'w')
const dev = spawn('npx', ['next', 'dev', '-p', '3304'], {
  env: {...process.env, NODE_OPTIONS: `--require ${new URL('./helpers/stripe-sandbox.cjs', import.meta.url).pathname}`, STRIPE_BLOCK_LOG: '/tmp/stripe-blocked-costs-test.log', NEXT_PUBLIC_SUPABASE_URL: SUPA, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test_offline', NEXT_TELEMETRY_DISABLED: '1'},
  stdio: ['ignore', log, log],
})
const stop = () => { try { dev.kill() } catch {} stub.close() }
process.on('exit', stop)
for (let i = 0; i < 90; i += 1) { try { await fetch(base + '/login'); break } catch { await new Promise((r) => setTimeout(r, 1000)) } }

const day = (n) => `2026-10-${String(n).padStart(2, '0')}`
const rawFor = (days, todayCost = 0.1) => ({
  by_operation: [
    {provider: 'serper', operation: 'maps_search', requests: 180, failed: 4, credits: 540, input_tokens: 0, output_tokens: 0, cost: 0.54, unpriced: 0},
    {provider: 'google_places', operation: 'text_search', requests: 60, failed: 0, credits: 0, input_tokens: 0, output_tokens: 0, cost: 2.4, unpriced: 0},
    {provider: 'google_places', operation: 'place_details', requests: 410, failed: 0, credits: 0, input_tokens: 0, output_tokens: 0, cost: 8.2, unpriced: 0},
    {provider: 'openai', operation: 'chat_completion', requests: 95, failed: 0, credits: 0, input_tokens: 190000, output_tokens: 28500, cost: 0.0456, unpriced: 3},
  ],
  by_purpose: [{provider: 'openai', purpose: 'research_profile', requests: 95, ok_requests: 92, cost: 0.0456}],
  daily: days.flatMap((d, i) => [
    {day: d, provider: 'serper', requests: 10 + i, cost: 0.03 + i * 0.006}, {day: d, provider: 'google_places', requests: 30 + i * 3, cost: 0.4 + i * 0.05}, {day: d, provider: 'openai', requests: 4, cost: 0.002},
  ]),
  daily_delivered: days.map((d, i) => ({day: d, runs: 2, delivered: i === 2 ? 0 : 12 + i})),
  runs: {count: 24, delivered: 160, duplicates: 38, rejected: 21},
  first_event_at: '2026-10-02T10:00:00Z',
  today_by_provider: [{provider: 'google_places', cost: todayCost}, {provider: 'serper', cost: 0.012}],
  month_by_provider: [{provider: 'google_places', cost: 10.6}, {provider: 'serper', cost: 0.54}, {provider: 'openai', cost: 0.0456}],
  month_delivered: 160,
  google_sku_events: {text_search: 60, place_details: 410, basic_data: 470, contact_data: 470, atmosphere_data: 60},
})
const week = [4, 5, 6, 7, 8, 9, 10].map(day)
const LIMITS = [{scope: 'monthly', provider: 'google_places', limit_usd: 12, alert_at_percent: 80, enforce: false}, {scope: 'monthly', provider: 'serper', limit_usd: 50, alert_at_percent: 80, enforce: false}]
const readyBody = (days = week, todayCost = 0.1) => ({state: 'ready', report: buildCostReport(rawFor(days, todayCost), {daily: [{day: '2026-09-28', settled: 5, cost: 0.0021}], first_settled_at: '2026-09-28T00:00:00Z'}, LIMITS, {days: days.length}), range: {from: '2026-10-04T00:00:00Z', to: '2026-10-11T00:00:00Z', days: days.length}})

// A fake of the reconciliation routes: the real validation and view builder, an in-memory store.
function reconciliationApi() {
  const saved = new Map(); const purchases = []; const calls = {put: 0, post: 0, get: 0}
  const estimated = [{provider: 'serper', requests: 120, credits: 360, cost: 0.36, unpriced: 0}, {provider: 'google_places', requests: 470, credits: 0, cost: 10.6, unpriced: 0}, {provider: 'openai', requests: 95, credits: 0, cost: 0.0456, unpriced: 3}]
  const view = (month) => ({state: 'ready', view: buildReconciliationView({month: `${month.slice(0, 7)}-01`, estimated, reconciliations: [...saved.values()].filter((r) => r.billing_month === `${month.slice(0, 7)}-01`), purchases: purchases.map((p, i) => ({id: i + 1, ...p}))})})
  const today = new Intl.DateTimeFormat('en-CA').format(new Date())
  return {
    calls, saved, purchases,
    handle: async (route, url) => {
      const method = route.request().method()
      if (url.pathname.endsWith('/reconciliation') && method === 'GET') { calls.get += 1; return route.fulfill({json: view(url.searchParams.get('month') || '2026-10')}) }
      if (url.pathname.endsWith('/reconciliation') && method === 'PUT') {
        calls.put += 1
        const parsed = parseReconciliationInput(route.request().postDataJSON(), today)
        if (!parsed.ok) return route.fulfill({status: 400, json: {error: parsed.error}})
        const v = parsed.value
        saved.set(`${v.billingMonth}:${v.provider}`, {billing_month: v.billingMonth, provider: v.provider, status: v.billedAmount === null ? 'pending' : 'reconciled', billed_amount: v.billedAmount, billed_currency: v.currency, exchange_rate_to_usd: v.exchangeRateToUsd,
          billed_usd: v.billedAmount === null ? null : Math.round(v.billedAmount * v.exchangeRateToUsd * 1e4) / 1e4, reported_credits: v.reportedCredits, reconciled_on: v.reconciledOn, estimated_usd_at_reconciliation: estimated.find((e) => e.provider === v.provider).cost, note: v.note})
        return route.fulfill({json: view(v.billingMonth)})
      }
      if (url.pathname.endsWith('/purchases') && method === 'POST') {
        calls.post += 1
        const parsed = parsePurchaseInput(route.request().postDataJSON(), today)
        if (!parsed.ok) return route.fulfill({status: 400, json: {error: parsed.error}})
        const v = parsed.value
        purchases.unshift({provider: v.provider, purchased_on: v.purchasedOn, amount_paid: v.amountPaid, currency: v.currency, exchange_rate_to_usd: v.exchangeRateToUsd, amount_usd: Math.round(v.amountPaid * v.exchangeRateToUsd * 1e4) / 1e4, credits: v.credits, note: v.note})
        return route.fulfill({json: {ok: true}})
      }
      return route.fulfill({status: 404, json: {}})
    },
  }
}

const results = []
async function scenario(name, fn) {
  try { await fn(); results.push(true); console.log(`PASS  ${name}`) } catch (error) { results.push(false); console.log(`FAIL  ${name}\n      ${String(error.message || error).split('\n').slice(0, 6).join('\n      ')}`) }
}
async function open(device, handler, plan = 'admin', {recon = reconciliationApi(), clock = false} = {}) {
  PLAN = plan
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  const context = await browser.newContext(device === 'phone' ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2} : {viewport: {width: 1280, height: 900}})
  const session = {access_token: 'aaa.bbb.ccc', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r', user: USER}
  await context.addCookies([{name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: base}])
  const requests = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === SUPA) return route.continue()
    if (url.origin !== new URL(base).origin) return route.abort()
    if (url.pathname === '/api/admin/costs') { requests.push(url.searchParams.toString()); return handler(route, url) }
    if (url.pathname.startsWith('/api/admin/costs/')) return recon.handle(route, url)
    if (url.pathname.startsWith('/api/')) return route.fulfill({json: {}})
    return route.continue()
  })
  const page = await context.newPage()
  if (clock) await page.clock.install()
  return {browser, page, requests, recon}
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const goto = async (page) => {
  await page.goto(`${base}/admin/costs`, {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.getByRole('heading', {name: 'Cost intelligence'}).waitFor({timeout: 120000})
}

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}: today, this month, figures, charts, table, Google billing events and the estimate notice are shown`, async () => {
    const {browser, page, requests} = await open(device, (route) => route.fulfill({json: readyBody()}))
    await goto(page)
    await page.getByText('Estimated, not billed.').waitFor()
    for (const text of ['Today · estimated', 'This month so far · estimated', 'Est. API spending', 'Businesses delivered', 'Est. cost per business', 'Est. AI research', 'Gross contribution', 'Not available', 'Daily spending', 'Spending by provider', 'Cost per delivered business', 'Request volume', 'Breakdown', 'Google billing events', 'Spending ceilings', 'Earlier research spending', 'Monthly reconciliation', 'Prepaid credit purchases']) {
      assert.ok(await page.getByText(text, {exact: false}).first().isVisible(), `${text} is shown`)
    }
    assert.equal(await page.getByTestId('today-total').innerText(), '$0.112', 'today: Google 0.10 + Serper 0.012')
    assert.equal(await page.getByTestId('month-total').innerText(), '$11.19')
    assert.ok(await page.getByText('470 events', {exact: false}).first().isVisible(), 'billing events are shown as events')
    assert.equal(await page.getByText('Google free monthly allowance').count(), 0, "no project-wide allowance is derived from ALPA's own counts")
    assert.ok(await page.getByText('shared across the whole Google project', {exact: false}).first().isVisible())
    assert.equal(await page.getByRole('img').count() >= 4, true, 'charts have accessible labels')
    assert.equal(await page.locator('table tbody tr').count(), 4)
    assert.ok(await page.getByText('Alert only: nothing is blocked').isVisible(), 'the approaching ceiling alerts without blocking')
    assert.ok(await page.getByText('Updated', {exact: false}).first().isVisible())
    assert.equal(await overflow(page), 0, 'no horizontal page scroll')
    assert.match(requests[0], /range=30d/); assert.match(requests[0], /tz=/)
    await page.screenshot({path: `${shots}/costs-${device}.png`, fullPage: true})
    await browser.close()
  })
}

await scenario('auto-refresh: the dashboard asks ALPA again every 60 seconds with the same filters, keeps the figures meanwhile, and does nothing while the tab is hidden', async () => {
  let todayCost = 0.1
  const {browser, page, requests} = await open('desktop', (route) => route.fulfill({json: readyBody(week, todayCost)}), 'admin', {clock: true})
  await goto(page)
  await page.getByTestId('today-total').waitFor()
  await page.getByRole('button', {name: '7 days'}).click(); await page.waitForTimeout(300)
  const costRequests = () => requests.length
  const base0 = costRequests()
  assert.equal(await page.getByTestId('today-total').innerText(), '$0.112')
  todayCost = 0.5
  await page.clock.fastForward(59_000); await page.waitForTimeout(250)
  assert.equal(costRequests(), base0, 'nothing before 60 seconds')
  await page.clock.fastForward(2_000)
  await page.waitForFunction(() => document.querySelector('[data-testid="today-total"]')?.textContent === '$0.512', null, {timeout: 10000})
  assert.equal(costRequests(), base0 + 1, 'one refresh after 60 seconds')
  assert.match(requests[requests.length - 1], /range=7d/, 'the selected filter is kept')
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}) })
  await page.clock.fastForward(130_000); await page.waitForTimeout(300)
  assert.equal(costRequests(), base0 + 1, 'a hidden tab does not poll')
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}) })
  await page.clock.fastForward(61_000); await page.waitForTimeout(300)
  assert.equal(costRequests(), base0 + 2, 'polling resumes when the tab is visible again')
  await browser.close()
})

await scenario('auto-refresh: a failed refresh keeps the figures on screen and says they may be out of date', async () => {
  let fail = false
  const {browser, page} = await open('desktop', (route) => (fail ? route.fulfill({status: 500, json: {state: 'error', message: 'x'}}) : route.fulfill({json: readyBody()})), 'admin', {clock: true})
  await goto(page)
  await page.getByTestId('today-total').waitFor()
  fail = true
  await page.clock.fastForward(61_000)
  await page.getByText('may be out of date', {exact: false}).first().waitFor({timeout: 10000})
  assert.equal(await page.getByTestId('today-total').innerText(), '$0.112', 'the last good figures stay')
  await browser.close()
})

await scenario('filters: each range asks the server for that range, custom needs both dates', async () => {
  const {browser, page, requests} = await open('desktop', (route) => route.fulfill({json: readyBody()}))
  await goto(page)
  for (const [label, range] of [['Today', 'today'], ['7 days', '7d'], ['30 days', '30d']]) {
    await page.getByRole('button', {name: label}).click(); await page.waitForTimeout(250)
    assert.ok(requests.some((r) => r.includes(`range=${range}`)), `${label} requested`)
  }
  const before = requests.length
  await page.getByRole('button', {name: 'Custom'}).click(); await page.waitForTimeout(300)
  assert.equal(requests.length, before, 'no request until both dates are chosen')
  await page.locator('#cost-from').fill('2026-10-01'); await page.locator('#cost-to').fill('2026-10-07'); await page.waitForTimeout(400)
  assert.ok(requests.some((r) => r.includes('range=custom') && r.includes('from=2026-10-01') && r.includes('to=2026-10-07')))
  await browser.close()
})

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}: monthly reconciliation - pending shows "Not reconciled", entering a bill shows actual, difference and status, a CAD bill needs its rate`, async () => {
    const {browser, page, recon} = await open(device, (route) => route.fulfill({json: readyBody()}))
    await goto(page)
    const rows = page.getByTestId('recon-rows')
    await rows.waitFor({timeout: 30000})
    for (const p of ['serper', 'google_places', 'openai']) {
      assert.equal(await page.getByTestId(`status-${p}`).innerText(), 'Pending')
      assert.equal(await page.getByTestId(`billed-${p}`).innerText(), 'Not reconciled')
    }
    // Google: a verified $0 bill against a $10.60 estimate
    await rows.getByRole('button', {name: 'Enter bill'}).nth(1).click()
    await page.locator('#google_places-amount').fill('0')
    await page.locator('#google_places-note').fill("Covered by Google's free allowance")
    await page.getByRole('button', {name: 'Save reconciliation'}).click()
    await page.getByTestId('status-google_places').filter({hasText: 'Reconciled'}).waitFor({timeout: 10000})
    assert.equal(await page.getByTestId('billed-google_places').innerText(), '$0.00')
    assert.match(await page.getByTestId('diff-google_places').innerText(), /−\$10\.60/, 'difference = actual minus estimated')
    assert.ok(await page.getByText("Covered by Google's free allowance").isVisible())
    assert.equal(await page.getByTestId('status-serper').innerText(), 'Pending', 'other providers are untouched')
    // OpenAI in CAD: the rate is required and stated
    await rows.getByRole('button', {name: 'Enter bill'}).nth(1).click() // openai is now the second remaining "Enter bill"
    await page.locator('#openai-amount').fill('0.10')
    await page.locator('#openai-currency').fill('CAD')
    await page.locator('#openai-rate').waitFor()
    await page.getByRole('button', {name: 'Save reconciliation'}).click()
    await page.getByRole('alert').filter({hasText: 'exchange rate'}).waitFor({timeout: 10000})
    assert.equal(await page.getByTestId('status-openai').innerText(), 'Pending', 'nothing was saved without a rate')
    await page.locator('#openai-rate').fill('0.72')
    await page.getByRole('button', {name: 'Save reconciliation'}).click()
    await page.getByTestId('status-openai').filter({hasText: 'Reconciled'}).waitFor({timeout: 10000})
    assert.ok(await page.getByText('0.1 CAD @ 0.72', {exact: false}).isVisible(), 'the original amount, currency and rate are kept')
    assert.equal(await page.getByTestId('billed-openai').innerText().then((t) => t.split('\n')[0]), '$0.072')
    assert.equal(await overflow(page), 0, 'no horizontal page scroll')
    assert.equal(recon.saved.size, 2)
    await page.screenshot({path: `${shots}/costs-reconciliation-${device}.png`, fullPage: true})
    await browser.close()
  })
}

await scenario('prepaid purchases are listed separately and change no estimate or reconciliation', async () => {
  const {browser, page, recon} = await open('desktop', (route) => route.fulfill({json: readyBody()}))
  await goto(page)
  await page.getByTestId('recon-rows').waitFor({timeout: 30000})
  const estimatedBefore = await page.getByText(/providers reconciled · estimated/).innerText()
  await page.getByRole('button', {name: 'Add purchase'}).click()
  await page.locator('#p-amount').fill('50'); await page.locator('#p-credits').fill('50000')
  await page.getByRole('button', {name: 'Save purchase'}).click()
  await page.getByTestId('purchases').waitFor({timeout: 10000})
  assert.ok(await page.getByTestId('purchases').getByText('50,000 credits', {exact: false}).isVisible())
  assert.equal(await page.getByText(/providers reconciled · estimated/).innerText(), estimatedBefore, 'the estimate did not change')
  assert.equal(recon.saved.size, 0); assert.equal(recon.purchases.length, 1)
  await browser.close()
})

await scenario('before the migration: honest "not switched on" messages for both sections, never zeros', async () => {
  const recon = reconciliationApi(); recon.handle = async (route) => route.fulfill({json: {state: 'not_enabled'}})
  const {browser, page} = await open('desktop', (route) => route.fulfill({json: {state: 'not_enabled', range: {}}}), 'admin', {recon})
  await goto(page)
  await page.getByText('Request-level tracking is not switched on yet.').waitFor({timeout: 30000})
  await page.getByText('Not switched on yet.', {exact: true}).waitFor({timeout: 30000})
  assert.equal(await page.getByText('Est. API spending').count(), 0)
  await browser.close()
})

await scenario('an empty range and a failed load are stated plainly', async () => {
  const empty = buildCostReport({by_operation: [], by_purpose: [], daily: [], daily_delivered: [], runs: {count: 0, delivered: 0, duplicates: 0, rejected: 0}, first_event_at: null, today_by_provider: [], month_by_provider: [], month_delivered: 0, google_sku_events: {}}, null, [], {days: 1})
  let mode = 'empty'
  const {browser, page} = await open('phone', (route) => route.fulfill(mode === 'empty' ? {json: {state: 'ready', report: empty, range: {}}} : {status: 500, json: {state: 'error', message: 'The cost figures could not be loaded.'}}))
  await goto(page)
  await page.getByText('No requests in this range').waitFor({timeout: 30000})
  assert.ok(await page.getByText('No requests have been recorded yet.').isVisible())
  assert.equal(await page.getByTestId('today-total').innerText(), '$0.00')
  assert.equal(await overflow(page), 0)
  mode = 'fail'; await page.getByRole('button', {name: '7 days'}).click()
  await page.getByText('The cost figures could not be loaded.').first().waitFor()
  await browser.close()
})

await scenario('only an administrator is served: every cost endpoint refuses a member and a signed-out caller', async () => {
  // The page itself redirects non-administrators (asserted in the unit tests); a member's page render needs Stripe in this older base,
  // which the offline sandbox refuses, so the browser checks the data endpoints, which are what actually hold the numbers.
  const asMember = await open('desktop', (route) => route.continue(), 'free')
  for (const [method, path] of [['get', '/api/admin/costs?range=7d'], ['get', '/api/admin/costs/reconciliation?month=2026-10']]) {
    const response = await asMember.page.request[method](`${base}${path}`)
    assert.equal(response.status(), 403, path); assert.doesNotMatch(await response.text(), /spend|cost|serper|billed/i)
  }
  for (const [method, path] of [['put', '/api/admin/costs/reconciliation'], ['post', '/api/admin/costs/purchases']]) {
    const response = await asMember.page.request[method](`${base}${path}`, {data: {provider: 'serper'}})
    assert.equal(response.status(), 403, `${method} ${path}`)
  }
  await asMember.browser.close()
  for (const path of ['/api/admin/costs?range=7d', '/api/admin/costs/reconciliation?month=2026-10']) assert.equal((await fetch(`${base}${path}`)).status, 401, path)
  assert.equal((await fetch(`${base}/api/admin/costs/purchases`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'})).status, 401)
  const asAdmin = await open('desktop', (route) => route.continue(), 'admin')
  assert.equal((await asAdmin.page.request.get(`${base}/api/admin/costs?range=bogus`)).status(), 400, 'past the guard, a bad range is a 400')
  await asAdmin.browser.close()
})

console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios passed`)
stop()
process.exit(results.every(Boolean) ? 0 : 1)
