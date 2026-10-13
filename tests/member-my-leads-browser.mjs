// The signed-in My Leads workspace in a real browser, against a fake sign-in service, to prove the shared components still serve
// members unchanged. Nothing real is reached: Supabase is a local stub and every /api request is answered here.
//   node tests/member-my-leads-browser.mjs          (starts its own dev server on :3303 and the stub on :3398)
import assert from 'node:assert/strict'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'

const SUPA = 'http://localhost:3398'
const base = process.env.BASE_URL || 'http://localhost:3303'
const USER = {id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'member@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'}
const PROFILE = {plan: 'admin', stripe_customer_id: null, stripe_subscription_id: null, subscription_status: 'active', plan_status: 'active', cancel_at_period_end: false, current_period_end: '2027-01-01T00:00:00Z', canceled_at: null, subscription_tier: 'starter', created_at: '2026-01-01T00:00:00Z'}

const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json'}
const stubLog = []
const stub = http.createServer((req, res) => {
  stubLog.push(`${req.method} ${req.url.slice(0, 60)}`)
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  const object = String(req.headers.accept || '').includes('vnd.pgrst.object')
  if (req.url.startsWith('/auth/v1/user')) { res.writeHead(200, cors); return res.end(JSON.stringify(USER)) }
  if (req.url.startsWith('/rest/v1/profiles')) { res.writeHead(200, cors); return res.end(JSON.stringify(object ? PROFILE : [PROFILE])) }
  if (object) { res.writeHead(406, cors); return res.end(JSON.stringify({code: 'PGRST116', message: 'no rows', details: '', hint: ''})) }
  res.writeHead(200, cors); res.end('[]')
}).listen(3398)

const dev = spawn('npx', ['next', 'dev', '-p', '3303'], {
  env: {...process.env, NEXT_PUBLIC_SUPABASE_URL: SUPA, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test_offline', NEXT_TELEMETRY_DISABLED: '1'},
  stdio: ['ignore', (await import('node:fs')).openSync('/tmp/member-dev.log', 'w'), (await import('node:fs')).openSync('/tmp/member-dev.log', 'a')],
})
const stop = () => { try { dev.kill() } catch {} stub.close() }
process.on('exit', stop)
for (let i = 0; i < 60; i += 1) { try { await fetch(base + '/login'); break } catch { await new Promise((r) => setTimeout(r, 1000)) } }

const item = (n, over = {}) => ({id: `m-${n}`, company_name: `Member Business ${n}`, industry: 'Plumbing', city: 'Laval', email: `a@m${n}.ca`, phone: '+1 450 555 0100', website: `https://m${n}.ca`, has: {email: true, phone: true, website: true}, archived: false, created_at: '2026-10-01T00:00:00Z', last_activity_at: '2026-10-12T00:00:00Z', intelligence: {state: 'ready', label: 'Profile ready', preview: 'Plumbing for homes.'}, ...over})
const items = [item(1), item(2, {intelligence: {state: 'queued', label: 'Queued', preview: null}, has: {email: false, phone: true, website: true}, email: null}), item(3, {intelligence: {state: 'failed', label: 'Needs attention', preview: null}})]
const dossier = (id) => ({ok: true, lead: {
  id, company_name: 'Member Business 1', industry: 'Plumbing', city: 'Laval', archived: false, status: null, pipeline_stage: null, notes: 'Called last week.', created_at: '2026-10-01T00:00:00Z', last_activity_at: '2026-10-12T00:00:00Z', source: null,
  contact: {name: 'Jo Tremblay', email: 'a@m1.ca', email_source: null, email_confidence: 'high', is_generic_email: false, phone: '+1 450 555 0100', website: 'https://m1.ca', source_url: null},
  intelligence: {state: 'ready', label: 'Profile ready', reason: null, researched_at: '2026-10-05T00:00:00Z',
    card: {summary: 'Residential plumbing repairs and installations.', services: [], audience: null, facts: {signals: ['Mentions pricing'], pagesRead: ['Home', 'Services'], sources: [{label: 'm1.ca', url: 'https://m1.ca/'}]}, limitations: ['Based on two pages only.']},
    profile: {industry: 'Plumbing', business_category: 'Home services', primary_service: null, core_services: ['Repairs', 'Installations'], target_customer: 'Homeowners', keywords: ['pipes', 'heating']}},
}})

const results = []
async function scenario(name, device, fn) {
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  const context = await browser.newContext(device === 'phone' ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 3} : {viewport: {width: 1280, height: 900}})
  const session = {access_token: 'aaa.bbb.ccc', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r', user: USER}
  await context.addCookies([{name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: base}])
  const requests = []
  stubLog.length = 0
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === SUPA) return route.continue()
    if (url.origin !== new URL(base).origin) return route.abort()
    if (url.pathname === '/api/my-leads') {
      requests.push(url.search)
      if (url.searchParams.get('summary')) return route.fulfill({json: {ok: true, items: [], total: 3, page: 1, pageSize: 1, hasMore: false, summary: {total: 3, archived: 1, ready: 1, awaiting: 1, attention: 1}}})
      const q = (url.searchParams.get('q') || '').toLowerCase()
      const shown = q ? items.filter((i) => i.company_name.toLowerCase().includes(q)) : items
      return route.fulfill({json: {ok: true, items: shown, total: shown.length, page: 1, pageSize: 25, hasMore: false}})
    }
    if (url.pathname.startsWith('/api/my-leads/') && url.pathname !== '/api/my-leads/export') return route.fulfill({json: dossier(url.pathname.split('/').pop())})
    if (url.pathname.startsWith('/api/')) return route.fulfill({json: {}})
    return route.continue()
  })
  const page = await context.newPage()
  let ok = true, detail = ''
  try { await fn(page, requests) } catch (e) { ok = false; detail = String(e.message).split('\n')[0] + ` [at ${page.url()}]` }
  await browser.close()
  results.push({name, ok, detail})
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail}`}`)
}

const rows = (page) => page.locator('section[aria-label="Businesses"] > ul > li')

await scenario('members: the workspace is unchanged (header, overview, tabs, filters, five sorts, rows with selection, status and activity)', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await page.getByRole('heading', {name: 'My Leads'}).waitFor({timeout: 60000})
  for (const label of ['Businesses', 'Profiles ready', 'Awaiting intelligence', 'Need attention']) await page.getByText(label, {exact: true}).first().waitFor()
  await page.getByRole('tab', {name: 'Active'}).waitFor()
  await page.getByRole('tab', {name: /Archived/}).waitFor()
  await page.getByLabel('Intelligence').waitFor()
  assert.equal(await page.getByLabel('Sort').locator('option').count(), 5)
  await rows(page).first().waitFor()
  assert.equal(await rows(page).count(), 3)
  assert.equal(await rows(page).first().locator('input[type=checkbox]').count(), 1)
  await rows(page).first().getByText('Profile ready').first().waitFor()
  await page.screenshot({path: '/private/tmp/alpa-guest-browser/member-desktop-list.png'})
})

await scenario('members: an expanded row shows the shared who / what / how to reach, plus their own intelligence, notes and actions', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  const region = page.getByRole('region', {name: /Member Business 1 details/})
  for (const h of ['Who they are', 'What they do', 'How to reach them', 'Business Intelligence', 'Business signals', 'Notes and actions']) await region.getByRole('heading', {name: h}).waitFor()
  await region.getByText('Residential plumbing repairs and installations.').waitFor()
  await region.getByText('A summary of what their website says').waitFor()
  await region.getByText('Repairs · Installations').waitFor()
  await region.getByText('Homeowners').waitFor()
  assert.equal(await region.locator('a[href="mailto:a@m1.ca"]').count(), 1)
  await region.getByRole('button', {name: 'Archive'}).waitFor()
  await region.getByText('Called last week.').waitFor()
  await region.getByText('Mentions pricing').waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0, 'members keep the inline dossier')
  await page.screenshot({path: '/private/tmp/alpa-guest-browser/member-desktop-dossier.png'})
})

await scenario('members: selecting a row offers the bulk actions; searching calls the endpoint with the query', 'desktop', async (page, requests) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await rows(page).first().locator('input[type=checkbox]').check()
  await page.getByRole('toolbar').getByText('1 selected').waitFor()
  await page.getByRole('button', {name: 'Export CSV'}).waitFor()
  await page.getByRole('button', {name: 'Archive'}).first().waitFor()
  await page.getByRole('searchbox').fill('Business 2')
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Businesses"] > ul > li').length === 1)
  assert.ok(requests.some((r) => r.includes('q=Business+2') || r.includes('q=Business%202')), 'the search reached the endpoint')
})

await scenario('members on a phone: still inline (no bottom sheet), full controls, no horizontal scroll', 'phone', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  await page.getByRole('region', {name: /Member Business 1 details/}).getByRole('heading', {name: 'How to reach them'}).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({path: '/private/tmp/alpa-guest-browser/member-phone-dossier.png'})
})

stop()
console.log('stub saw:', stubLog.slice(0, 8))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`)
process.exit(failed.length ? 1 : 0)
