// The signed-in My Leads workspace in a real browser, against a fake sign-in service, to prove the shared components still serve
// members unchanged. Nothing real is reached: Supabase is a local stub and every /api request is answered here.
//   node tests/member-my-leads-browser.mjs          (starts its own dev server on :3303 and the stub on :3398)
import assert from 'node:assert/strict'
import http from 'node:http'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright'
import {buildStoredWebsiteFacts} from '../lib/leads/stored-website-facts.ts'

const SUPA = 'http://localhost:3398'
const base = process.env.BASE_URL || 'http://localhost:3303'
const USER = {id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'member@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z'}
const BASE_PROFILE = {plan: 'admin', stripe_customer_id: null, stripe_subscription_id: null, subscription_status: 'active', plan_status: 'active', cancel_at_period_end: false, current_period_end: '2027-01-01T00:00:00Z', canceled_at: null, subscription_tier: 'starter', created_at: '2026-01-01T00:00:00Z'}
let PROFILE = BASE_PROFILE

const state = {leadCount: 0}
import fs from 'node:fs'
const BLOCK_LOG = '/tmp/stripe-blocked-member-test.log'
fs.writeFileSync(BLOCK_LOG, '')

const cors = {'Access-Control-Expose-Headers': 'Content-Range', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Content-Type': 'application/json'}
const stubLog = []
const stub = http.createServer((req, res) => {
  stubLog.push(`${req.method} ${req.url.slice(0, 60)}`)
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  const object = String(req.headers.accept || '').includes('vnd.pgrst.object')
  if (req.url.startsWith('/auth/v1/user')) { res.writeHead(200, cors); return res.end(JSON.stringify(USER)) }
  if (req.method === 'HEAD' && (req.url.startsWith('/rest/v1/leads') || req.url.startsWith('/rest/v1/business_allowance_ledger'))) { res.writeHead(200, {...cors, 'Content-Range': `*/${state.leadCount}`}); return res.end() }
  if (req.url.startsWith('/rest/v1/users')) { res.writeHead(200, cors); return res.end(JSON.stringify(object ? {id: USER.id, email: USER.email, plan: PROFILE.plan} : [{id: USER.id, email: USER.email, plan: PROFILE.plan}])) }
  if (req.url.startsWith('/rest/v1/usage')) { res.writeHead(200, cors); const row = {leads_used: 120, leads_limit: 500, period_start: '2026-10-01T00:00:00Z', period_end: '2026-11-01T00:00:00Z'}; return res.end(JSON.stringify(object ? row : [row])) }
  if (req.url.startsWith('/rest/v1/profiles')) { res.writeHead(200, cors); return res.end(JSON.stringify(object ? PROFILE : [PROFILE])) }
  if (object) { res.writeHead(406, cors); return res.end(JSON.stringify({code: 'PGRST116', message: 'no rows', details: '', hint: ''})) }
  res.writeHead(200, cors); res.end('[]')
}).listen(3398)

const dev = spawn('npx', ['next', 'dev', '-p', '3303'], {
  env: {...process.env, NODE_OPTIONS: `--require ${new URL('./helpers/stripe-sandbox.cjs', import.meta.url).pathname}`, STRIPE_BLOCK_LOG: BLOCK_LOG, NEXT_PUBLIC_SUPABASE_URL: SUPA, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', STRIPE_SECRET_KEY: 'sk_test_offline', NEXT_TELEMETRY_DISABLED: '1'},
  stdio: ['ignore', (await import('node:fs')).openSync('/tmp/member-dev.log', 'w'), (await import('node:fs')).openSync('/tmp/member-dev.log', 'a')],
})
const stop = () => { try { dev.kill() } catch {} stub.close() }
process.on('exit', stop)
for (let i = 0; i < 60; i += 1) { try { await fetch(base + '/login'); break } catch { await new Promise((r) => setTimeout(r, 1000)) } }

const item = (n, over = {}) => ({id: `m-${n}`, company_name: `Member Business ${n}`, industry: 'Plumbing', city: 'Laval', email: `a@m${n}.ca`, phone: '+1 450 555 0100', website: `https://m${n}.ca`, has: {email: true, phone: true, website: true}, archived: false, created_at: '2026-10-01T00:00:00Z', last_activity_at: '2026-10-12T00:00:00Z', intelligence: {state: 'ready', label: 'Profile ready', preview: 'Plumbing for homes.'}, ...over})
const items = [item(1), item(2, {intelligence: {state: 'queued', label: 'Queued', preview: null}, has: {email: false, phone: true, website: true}, email: null}), item(3, {intelligence: {state: 'failed', label: 'Needs attention', preview: null}})]
const dossier = (id, over = {}) => ({ok: true, lead: {
  id, company_name: 'Member Business 1', industry: 'Plumbing', city: 'Laval', archived: false, status: null, pipeline_stage: null, notes: 'Called last week.', created_at: '2026-10-01T00:00:00Z', last_activity_at: '2026-10-12T00:00:00Z', source: null,
  contact: {name: 'Jo Tremblay', email: 'a@m1.ca', email_source: null, email_confidence: 'high', is_generic_email: false, phone: '+1 450 555 0100', website: 'https://m1.ca', source_url: null},
  intelligence: {state: 'ready', label: 'Profile ready', reason: null, researched_at: '2026-10-05T00:00:00Z',
    card: {summary: 'Residential plumbing repairs and installations.', services: [], audience: null, facts: {signals: ['Mentions pricing'], pagesRead: ['Home', 'Services'], sources: [{label: 'm1.ca', url: 'https://m1.ca/'}]}, limitations: ['Based on two pages only.']},
    profile: {industry: 'Plumbing', business_category: 'Home services', primary_service: null, core_services: ['Repairs', 'Installations'], target_customer: 'Homeowners', keywords: ['pipes', 'heating']}},
  website: null,
  ...over,
}})

const results = []
async function scenario(name, device, fn, extra = {}) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  PROFILE = {...BASE_PROFILE, ...(extra.profile ?? {})}
  state.leadCount = extra.leadCount ?? 0
  const browser = await chromium.launch({headless: true, channel: 'chrome'})
  const context = await browser.newContext(device === 'phone' ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 3} : {viewport: {width: 1280, height: 900}})
  const session = {access_token: 'aaa.bbb.ccc', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r', user: USER}
  if (!extra.anonymous) await context.addCookies([{name: 'sb-localhost-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: base}])
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
    if (url.pathname === '/api/guest/session') return route.fulfill({json: {leads: extra.guestLeads ?? [], used: (extra.guestLeads ?? []).length, attempts: 1, searching: false}})
    if (url.pathname.startsWith('/api/my-leads/') && url.pathname !== '/api/my-leads/export') return route.fulfill({json: extra.dossier ? extra.dossier(url.pathname.split('/').pop()) : dossier(url.pathname.split('/').pop())})
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
  await region.getByText('AI summary', {exact: true}).waitFor()
  await region.getByText('Written by AI from their website. Not independently verified.').waitFor()
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


// ------------------------------------------------------------------------------------------ Phase 4: guest -> signup -> member
const guestLead = {id: 'g-1', company_name: 'Clinique Laval', city: 'Laval', industry: 'Dentist', email: 'info@cliniquelaval.ca', phone: null, website: 'https://cliniquelaval.ca', email_confidence: 'medium', is_generic_email: false,
  website_intelligence: {title: 'Clinique Laval', description: 'Family dental care in Laval since 1998.', headings: ['Teeth whitening', 'Implants'], source_urls: ['https://cliniquelaval.ca/']}, email_inspection: {state: 'checked', partial: true}, created_at: '2026-10-13T00:00:00Z'}
// What the claim stores for that business (the real function), as the database would hand it back, with no AI profile.
const stored = JSON.parse(JSON.stringify(buildStoredWebsiteFacts(guestLead)))
const imported = (over = {}) => (id) => ({ok: true, lead: {
  id, company_name: guestLead.company_name, industry: 'Dentist', city: 'Laval', archived: false, status: null, pipeline_stage: null, notes: null, created_at: '2026-10-13T00:00:00Z', last_activity_at: null, source: 'serper',
  website: stored,
  contact: {name: null, email: guestLead.email, email_source: null, email_confidence: 'medium', is_generic_email: false, phone: null, website: guestLead.website, source_url: null},
  intelligence: {state: 'not_started', label: 'Not generated', reason: null, researched_at: null, card: null, profile: null},
  ...over,
}})

await scenario('guest dossier -> signup -> My Leads: the website facts are the same words, labelled as the website\'s, with no AI summary invented', 'desktop', async (page) => {
  // 1. what the guest sees
  await page.goto(base + '/trial/results')
  await page.getByRole('button', {name: /Clinique Laval/}).first().click()
  const guestRegion = page.getByRole('region', {name: /Clinique Laval details/})
  await guestRegion.getByText('Family dental care in Laval since 1998.').waitFor()
  const guestText = await guestRegion.innerText()
  // 2. the same business after signup, in the member workspace
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  const region = page.getByRole('region', {name: /details/})
  for (const h of ['Who they are', 'What they do', 'How to reach them']) await region.getByRole('heading', {name: h}).waitFor()
  await region.getByText('Family dental care in Laval since 1998.').waitFor()
  await region.getByText('Teeth whitening').waitFor()
  await region.getByText('Implants').waitFor()
  assert.equal(await region.getByText('AI summary').count(), 0, 'no AI summary is shown or invented')
  await region.getByText('No business profile has been generated for this business yet.').waitFor()
  assert.equal(await region.locator('a[href="mailto:info@cliniquelaval.ca"]').count(), 1)
  const memberText = await region.innerText()
  for (const sentence of ['Family dental care in Laval since 1998.', 'Teeth whitening', 'Implants', 'These are statements from the business website. ALPA has not independently confirmed them. Some website pages could not be read.']) {
    assert.ok(guestText.includes(sentence), `the guest saw: ${sentence}`)
    assert.ok(memberText.includes(sentence), `kept after signup: ${sentence}`)
  }
  await page.screenshot({path: '/private/tmp/alpa-guest-browser/member-imported-dossier.png'})
}, {guestLeads: [guestLead], dossier: imported()})

await scenario('imported business with missing contact details and incomplete facts: stated plainly, nothing filled in', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  const region = page.getByRole('region', {name: /details/})
  await region.getByText(/Their website is titled “Only a title”\./).waitFor()
  assert.equal(await region.getByText('AI summary').count(), 0)
  assert.equal(await region.locator('a[href^="tel:"]').count(), 0, 'no phone invented')
  assert.equal(await region.locator('a[href^="mailto:"]').count(), 0, 'no email invented')
  await region.getByText('No contact details were found for this business.').waitFor()
}, {dossier: imported({website: {...stored, description: null, title: 'Only a title', headings: [], inspection: null}, contact: {name: null, email: null, email_source: null, email_confidence: null, is_generic_email: false, phone: null, website: null, source_url: null}})})

await scenario('when the business also has an AI profile, both are shown and labelled as different things', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  const region = page.getByRole('region', {name: /details/})
  await region.getByText('AI summary', {exact: true}).waitFor()
  await region.getByText('Written by AI from their website. Not independently verified.').waitFor()
  await region.getByText('From their website', {exact: true}).waitFor()
  await region.getByText('Family dental care in Laval since 1998.').waitFor()
  await region.getByText('Residential plumbing repairs and installations.').waitFor()
  await page.screenshot({path: '/private/tmp/alpa-guest-browser/member-ai-and-website.png'})
}, {dossier: (id) => dossier(id, {website: stored})})

await scenario('members on a phone see the imported facts inline as well', 'phone', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  await page.getByRole('region', {name: /details/}).getByText('Family dental care in Laval since 1998.').waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
}, {dossier: imported()})


// ---------------------------------------------------------------------------------------------------- Phase 5: conversion
const FREE = {plan: 'free', plan_status: 'free', subscription_status: 'free', stripe_customer_id: null, stripe_subscription_id: null, subscription_tier: 'free', current_period_end: null}
const panelHeading = (page) => page.getByRole('heading', {name: "You've discovered your 25 free businesses."})
const discoverForm = (page) => page.locator('#discover-business-type')

await scenario('free member at 25: the upgrade moment replaces the search form (no pop-up), with the offer previewed and not promised', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/scraper')
  await panelHeading(page).waitFor({timeout: 60000})
  await page.getByText('Ready to find more?').waitFor()
  await page.getByText('Enjoy 50% off your first month of ALPA when you upgrade.').waitFor()
  await page.getByText('The discount applies to your first month only. Regular pricing resumes afterward.').waitFor()
  await page.getByText(/not active yet, so nothing is discounted today/).waitFor()
  await page.getByText(/Upcoming offer · not active yet/).waitFor()
  assert.equal(await page.getByRole('link', {name: 'Explore ALPA plans →'}).getAttribute('href'), '/plans')
  assert.equal(await page.getByRole('link', {name: 'View my businesses →'}).getAttribute('href'), '/dashboard/my-leads')
  assert.equal(await discoverForm(page).count(), 0, 'no search form that would lead to an error')
  assert.equal(await page.getByRole('dialog').count(), 0, 'no pop-up')
  assert.equal(await page.getByText(/countdown|hurry|limited time|expires/i).count(), 0)
  await page.screenshot({path: '/private/tmp/alpa-guest-browser/member-upgrade-desktop.png'})
}, {profile: FREE, leadCount: 25})

await scenario('free member at 25 on a phone: readable, no horizontal scroll, large buttons', 'phone', async (page) => {
  await page.goto(base + '/dashboard/scraper')
  await panelHeading(page).waitFor({timeout: 60000})
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  for (const link of [page.getByRole('link', {name: 'Explore ALPA plans →'}), page.getByRole('link', {name: 'View my businesses →'})]) assert.ok((await link.boundingBox()).height >= 44)
  await page.screenshot({path: '/private/tmp/alpa-guest-browser/member-upgrade-phone.png'})
}, {profile: FREE, leadCount: 25})

// These two render the dossier a free or lapsed member's request returns (the route adds the note; unit-tested separately). They run with
// the harness's FREE profile on purpose: the harness refuses every Stripe request, so they also prove that My Leads works for a
// non-admin member while Stripe cannot be reached (the plan falls back to the stored one for display and grants nothing).
const PAID = {plan: 'starter', plan_status: 'active', subscription_status: 'active', stripe_customer_id: 'cus_test', stripe_subscription_id: 'sub_test', subscription_tier: 'starter', current_period_end: '2027-01-01T00:00:00Z'}
const FREE_NOTE = 'Automatic business profiles are included with paid plans. Your saved businesses, and any profile already written, stay available.'
const savedLight = {version: 1, summary: 'Clinique Laval is a family dental clinic in Laval. According to its website, it offers teeth whitening and implants for both children and adults across the city.', tags: ['Teeth whitening', 'Implants'], generated_at: '2026-10-14T00:00:00Z', model: 'gpt-4o-mini'}

await scenario('free member while Stripe is unreachable: a business without a profile says automatic profiles come with paid plans, and nothing is hidden', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  const region = page.getByRole('region', {name: /details/})
  await region.getByText(FREE_NOTE).waitFor()
  await region.getByText('Family dental care in Laval since 1998.').waitFor()
  assert.equal(await region.getByText(/available separately/i).count(), 0)
}, {dossier: imported({researchNote: FREE_NOTE}), profile: FREE})

await scenario('paying member while Stripe is unreachable: My Leads still lists and opens every business (no 500)', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  assert.equal(await rows(page).count(), 3)
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  await page.getByRole('region', {name: /details/}).getByText('Residential plumbing repairs and installations.').waitFor()
  assert.equal(await page.getByText(/server error occurred/i).count(), 0)
}, {profile: PAID})

// A free member who HAS a Stripe customer forces the plan lookup, which this harness refuses: the real outage path (connection failure,
// then the stored plan), not just the skipped lookup.
await scenario('member whose plan lookup hits an unreachable Stripe: My Leads still opens (stored plan shown, nothing granted)', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 90000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  await page.getByRole('region', {name: /details/}).getByText('Residential plumbing repairs and installations.').waitFor()
  assert.equal(await page.getByText(/server error occurred/i).count(), 0)
  const blocked = (await import('node:fs')).readFileSync(BLOCK_LOG, 'utf8')
  assert.ok(blocked.trim().length > 0, 'the plan lookup really was attempted and refused')
}, {profile: {...FREE, stripe_customer_id: 'cus_unreachable'}})

// ---- the account-first checkout journey, in a real browser, signed out
await scenario('signed out: choosing a plan carries the plan to sign-up, and the choice is kept for the sign-in that follows', 'desktop', async (page) => {
  await page.goto(base + '/plans')
  await page.getByRole('button', {name: /Start Prospecting|Start Building/}).first().click()
  await page.waitForURL(/\/login\?mode=signup&plan=(pro|starter)&source=/, {timeout: 60000})
  const plan = new URL(page.url()).searchParams.get('plan')
  assert.ok(['pro', 'starter'].includes(plan))
  const kept = await page.evaluate(() => window.localStorage.getItem('alpa_pending_checkout'))
  assert.ok(kept && JSON.parse(kept).plan === plan, 'the plan is also kept in the browser')
  // a later visit to plain /login (after confirming the email) still remembers the plan: the sign-in will continue to checkout
  await page.goto(base + '/login')
  assert.equal(JSON.parse(await page.evaluate(() => window.localStorage.getItem('alpa_pending_checkout'))).plan, plan)
}, {anonymous: true})

await scenario('signed in with a plan chosen earlier: the hand-over page asks the server once and shows a calm message if checkout cannot start', 'desktop', async (page, requests) => {
  let posts = 0
  await page.route('**/api/checkout', async (route) => { posts += 1; return route.fulfill({status: 500, json: {error: 'Unable to start checkout'}}) })
  await page.goto(base + '/checkout/start?plan=pro&source=plans_featured')
  await page.getByText('We could not start checkout').waitFor({timeout: 60000})
  await page.getByText('Unable to start checkout', {exact: true}).waitFor()
  await page.getByRole('link', {name: 'Back to plans'}).waitFor()
  await new Promise((r) => setTimeout(r, 1500))
  assert.equal(posts, 1, 'one request, no retry loop')
}, {})

await scenario('signed in and already subscribed: the hand-over page sends the customer to billing instead of a second checkout', 'desktop', async (page) => {
  await page.route('**/api/checkout', (route) => route.fulfill({status: 409, json: {error: 'You already have a subscription.', code: 'already_subscribed'}}))
  await page.route('**/dashboard/billing', (route) => route.fulfill({contentType: 'text/html', body: '<h1>billing-page</h1>'}))
  await page.goto(base + '/checkout/start?plan=starter')
  await page.waitForURL('**/dashboard/billing', {timeout: 60000})
}, {})

await scenario('after a downgrade the saved profile stays: summary, tags and the website information behind a disclosure', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByRole('button', {name: /Member Business 1/}).first().click()
  const region = page.getByRole('region', {name: /details/})
  await region.getByText(/is a family dental clinic in Laval/).waitFor()
  await region.getByRole('list', {name: 'Services'}).getByText('Teeth whitening').waitFor()
  assert.equal(await region.getByText('Family dental care in Laval since 1998.').isVisible(), false, 'collapsed behind the disclosure')
  await region.getByText('View original website information').click()
  await region.getByText('Family dental care in Laval since 1998.').waitFor()
  assert.equal(await region.getByText(FREE_NOTE).count(), 0, 'no "no profile" note next to a profile that exists')
}, {dossier: imported({lightProfile: savedLight, researchNote: FREE_NOTE}), profile: FREE})

await scenario('free member with room left (10 of 25) keeps discovering normally: the search form, no upgrade moment', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/scraper')
  await discoverForm(page).waitFor({timeout: 60000})
  assert.equal(await panelHeading(page).count(), 0)
  assert.equal(await page.getByText(/50% off/).count(), 0)
}, {profile: FREE, leadCount: 10})

await scenario('a free member who had a subscription before sees the same page with no discount (it is a first-month offer)', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/scraper')
  await panelHeading(page).waitFor({timeout: 60000})
  await page.getByText('Ready to find more?').waitFor()
  assert.equal(await page.getByText(/50% off|first month|not active yet/i).count(), 0)
  await page.getByRole('link', {name: 'Explore ALPA plans →'}).waitFor()
}, {profile: {...FREE, plan_status: 'canceled', subscription_status: 'canceled', canceled_at: '2026-06-01T00:00:00Z'}, leadCount: 25})

await scenario('paid subscribers are never interrupted: their search form stays, whatever their library holds', 'desktop', async (page) => {
  await page.goto(base + '/dashboard/scraper')
  await discoverForm(page).waitFor({timeout: 60000})
  assert.equal(await panelHeading(page).count(), 0)
  assert.equal(await page.getByText(/50% off/).count(), 0)
}, {profile: {plan: 'starter', plan_status: 'active', subscription_status: 'active', stripe_customer_id: 'cus_test', stripe_subscription_id: 'sub_test', subscription_tier: 'starter', current_period_end: '2027-01-01T00:00:00Z'}, leadCount: 400})

const claimed = (result) => (page) => page.addInitScript((value) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); sessionStorage.setItem('alpa_guest_claim_result', JSON.stringify(value)) } }, result)

await scenario('a free account that could not hold every guest business is told so, plainly, and can dismiss it', 'desktop', async (page) => {
  await claimed({success: true, imported: 15, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: 10})(page)
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByText('We saved 15 of your 25 free-trial businesses to My Leads.').waitFor()
  await page.getByText(/10 were not added\. They are still on your free trial page until that expires/).waitFor()
  assert.equal(await page.getByRole('link', {name: 'View them →'}).getAttribute('href'), '/trial/results')
  await page.screenshot({path: '/private/tmp/alpa-guest-browser/member-claim-notice.png'})
  await page.getByRole('button', {name: 'Dismiss'}).click()
  assert.equal(await page.getByText(/free-trial businesses/).count(), 0)
  await page.reload()
  await rows(page).first().waitFor()
  assert.equal(await page.getByText(/free-trial businesses/).count(), 0, 'it does not come back once dismissed')
}, {})

await scenario('when everything fits, the notice is a quiet confirmation (no plans pitch)', 'phone', async (page) => {
  await claimed({success: true, imported: 25, skipped_invalid: 0, skipped_duplicate: 0, skipped_allowance: 0})(page)
  await page.goto(base + '/dashboard/my-leads')
  await rows(page).first().waitFor({timeout: 60000})
  await page.getByText('25 of your free-trial businesses are saved in My Leads.').waitFor()
  assert.equal(await page.getByRole('link', {name: 'Explore plans'}).count(), 0)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
}, {})

stop()
console.log(`Stripe attempts by the application: ${fs.readFileSync(BLOCK_LOG, 'utf8').split('\\n').filter(Boolean).length}, all refused locally by tests/helpers/stripe-sandbox.cjs; none left the machine`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`)
process.exit(failed.length ? 1 : 0)
