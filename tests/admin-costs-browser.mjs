// The Cost intelligence page in a real browser, phone and desktop, against a fake sign-in service. Every /api request is answered
// here from the real report builder; no database, provider or Stripe is reached.
//   node tests/admin-costs-browser.mjs        (starts its own dev server on :3304 and the stub on :3399)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {buildCostReport} from '../lib/costs/report.ts'

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
const rawFor = (days) => ({
  by_operation: [
    {provider: 'serper', operation: 'maps_search', requests: 180, failed: 4, credits: 176, input_tokens: 0, output_tokens: 0, cost: 0.176, unpriced: 0},
    {provider: 'google_places', operation: 'text_search', requests: 60, failed: 0, credits: 0, input_tokens: 0, output_tokens: 0, cost: 1.92, unpriced: 0},
    {provider: 'google_places', operation: 'place_details', requests: 410, failed: 0, credits: 0, input_tokens: 0, output_tokens: 0, cost: 8.2, unpriced: 0},
    {provider: 'openai', operation: 'chat_completion', requests: 95, failed: 0, credits: 0, input_tokens: 190000, output_tokens: 28500, cost: 0.0456, unpriced: 3},
  ],
  by_purpose: [{provider: 'openai', purpose: 'research_profile', requests: 95, ok_requests: 92, cost: 0.0456}],
  daily: days.flatMap((d, i) => [
    {day: d, provider: 'serper', requests: 10 + i, cost: 0.01 + i * 0.002}, {day: d, provider: 'google_places', requests: 30 + i * 3, cost: 0.4 + i * 0.05}, {day: d, provider: 'openai', requests: 4, cost: 0.002},
  ]),
  daily_delivered: days.map((d, i) => ({day: d, runs: 2, delivered: i === 2 ? 0 : 12 + i})),
  runs: {count: 24, delivered: 160, duplicates: 38, rejected: 21},
  first_event_at: '2026-10-02T10:00:00Z',
  month_by_provider: [{provider: 'google_places', cost: 10.1}, {provider: 'serper', cost: 0.176}, {provider: 'openai', cost: 0.0456}],
  google_month_events: {text_search: 60, place_details: 4100, contact_data: 910},
})
const week = [4, 5, 6, 7, 8, 9, 10].map(day)
const readyBody = (days = week) => ({state: 'ready', report: buildCostReport(rawFor(days), {daily: [{day: '2026-09-28', settled: 5, cost: 0.0021}], first_settled_at: '2026-09-28T00:00:00Z'}, [
  {scope: 'monthly', provider: 'google_places', limit_usd: 12, alert_at_percent: 80, enforce: false}, {scope: 'monthly', provider: 'serper', limit_usd: 50, alert_at_percent: 80, enforce: false}], {days: days.length}), range: {from: '2026-10-04T00:00:00Z', to: '2026-10-11T00:00:00Z', days: days.length}})

const results = []
async function scenario(name, fn) {
  const t0 = Date.now()
  try { await fn(); results.push(true); console.log(`PASS  ${name}`) } catch (error) { results.push(false); console.log(`FAIL  ${name}\n      ${String(error.message || error).split('\n').slice(0, 6).join('\n      ')}`) }
  void t0
}
async function open(device, handler, plan = 'admin') {
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
    if (url.pathname.startsWith('/api/')) return route.fulfill({json: {}})
    return route.continue()
  })
  const page = await context.newPage()
  return {browser, page, requests}
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

for (const device of ['desktop', 'phone']) {
  await scenario(`${device}: figures, charts, table, allowances and the estimate notice are shown`, async () => {
    const {browser, page, requests} = await open(device, (route) => route.fulfill({json: readyBody()}))
    await page.goto(`${base}/admin/costs`, {waitUntil: 'domcontentloaded', timeout: 120000})
    await page.getByRole('heading', {name: 'Cost intelligence'}).waitFor({timeout: 120000})
    await page.getByText('Estimated, not billed.').waitFor()
    for (const text of ['API spending', 'Businesses delivered', 'Cost per business', 'AI research', 'Gross contribution', 'Not available', 'Daily spending', 'Spending by provider', 'Cost per delivered business', 'Request volume', 'Breakdown', 'Google free monthly allowance', 'Spending ceilings', 'Earlier research spending']) {
      assert.ok(await page.getByText(text, {exact: false}).first().isVisible(), `${text} is shown`)
    }
    assert.equal(await page.getByRole('img').count() >= 4, true, 'charts have accessible labels')
    assert.ok(await page.getByText('$10.34', {exact: false}).first().isVisible(), 'total spending')
    assert.ok((await page.locator('table tbody tr').count()) === 4)
    assert.ok(await page.getByText('Alert only: nothing is blocked').isVisible(), 'the approaching ceiling alerts without blocking')
    assert.equal(await overflow(page), 0, 'no horizontal page scroll')
    assert.match(requests[0], /range=30d/); assert.match(requests[0], /tz=/)
    await page.screenshot({path: `${shots}/costs-${device}.png`, fullPage: true})
    await browser.close()
  })
}

await scenario('filters: each range asks the server for that range, custom needs both dates, and the last answer wins', async () => {
  const {browser, page, requests} = await open('desktop', (route) => route.fulfill({json: readyBody()}))
  await page.goto(`${base}/admin/costs`, {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.getByRole('heading', {name: 'Cost intelligence'}).waitFor({timeout: 120000})
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

await scenario('before the migration: an honest "not switched on" message, never zeros', async () => {
  const {browser, page} = await open('desktop', (route) => route.fulfill({json: {state: 'not_enabled', range: {}}}))
  await page.goto(`${base}/admin/costs`, {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.getByText('Request-level tracking is not switched on yet.').waitFor({timeout: 120000})
  assert.equal(await page.getByText('API spending').count(), 0)
  await browser.close()
})

await scenario('an empty range and a failed load are stated plainly', async () => {
  const empty = buildCostReport({by_operation: [], by_purpose: [], daily: [], daily_delivered: [], runs: {count: 0, delivered: 0, duplicates: 0, rejected: 0}, first_event_at: null, month_by_provider: [], google_month_events: {}}, null, [], {days: 1})
  let mode = 'empty'
  const {browser, page} = await open('phone', (route) => route.fulfill(mode === 'empty' ? {json: {state: 'ready', report: empty, range: {}}} : {status: 500, json: {state: 'error', message: 'The cost figures could not be loaded.'}}))
  await page.goto(`${base}/admin/costs`, {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.getByText('No requests in this range').waitFor({timeout: 120000})
  assert.ok(await page.getByText('No requests have been recorded yet.').isVisible())
  assert.equal(await overflow(page), 0)
  mode = 'fail'; await page.getByRole('button', {name: '7 days'}).click()
  await page.getByText('The cost figures could not be loaded.').first().waitFor()
  await browser.close()
})

await scenario('only an administrator is served: the API refuses a member and a signed-out caller, and does not refuse the administrator', async () => {
  // The page itself redirects non-administrators (asserted in the unit tests); a member's page render needs Stripe in this older base,
  // which the offline sandbox refuses, so the browser checks the data endpoint, which is what actually holds the numbers.
  const asMember = await open('desktop', (route) => route.continue(), 'free')
  const memberCalls = await asMember.page.request.get(`${base}/api/admin/costs?range=7d`)
  assert.equal(memberCalls.status(), 403); assert.doesNotMatch(await memberCalls.text(), /spend|cost|serper/i)
  await asMember.browser.close()
  const anonymous = await fetch(`${base}/api/admin/costs?range=7d`)
  assert.equal(anonymous.status, 401)
  const asAdmin = await open('desktop', (route) => route.continue(), 'admin')
  const adminCall = await asAdmin.page.request.get(`${base}/api/admin/costs?range=bogus`)
  assert.equal(adminCall.status(), 400, 'past the guard, a bad range is a 400')
  await asAdmin.browser.close()
})

console.log(`\n${results.filter(Boolean).length}/${results.length} scenarios passed`)
stop()
process.exit(results.every(Boolean) ? 0 : 1)
