#!/usr/bin/env node
// Billing security regression, in Stripe TEST mode against the isolated test project only (refuses to start otherwise):
//   1. Account B cannot look up or activate Account A's checkout session (unpaid and paid), and gets the same answer as for an unknown id.
//   2. A signed-out caller cannot use any billing operation; nothing is created in Stripe.
//   3. While Stripe is unreachable, paid discovery is refused for a webhook-synced paying customer and for a free one; nothing is consumed.
//   4. Webhook signature and replay, another customer's data, self-upgrade and operator functions.
// Needs: the production build running on NEXT_PUBLIC_APP_URL (any local port) and `stripe listen --forward-to <app>/api/stripe/webhook`.
// Run from the repository root (the outage scenario restarts `next start` from the current directory). No paid provider key may be set,
// so a search can never reach a paid provider; no email is sent (accounts are created through the TEST admin API).
//   node scripts/test-env/e2e/billing-security.mjs
import crypto from 'node:crypto'
import { chromium } from 'playwright'
import {
  BASE, assertIsolated, check, createUser, leadsOf, profileOf, refusedStripeAttempts, restartApp, results, rest, rows, scenario,
  sessionCookies, signIn, stripe, waitFor,
} from './lib.mjs'

assertIsolated()
const RUN = Date.now().toString(36)
const cookieHeader = (u) => sessionCookies(u.session).map((c) => `${c.name}=${c.value}`).join('; ')
async function api(u, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { ...(u ? { Cookie: cookieHeader(u) } : {}), Origin: BASE, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text, location: res.headers.get('location') }
}
async function account(tag, { leads = 0 } = {}) {
  const email = `alpa-sec-${RUN}-${tag}@example.com`
  const user = await createUser(email)
  const session = await signIn(email)
  for (let i = 0; i < leads; i += 1) {
    await rest('leads', { method: 'POST', body: { user_id: user.id, company_name: `Security ${RUN} ${tag} ${i}`, phone: `1555${RUN.slice(-4)}${i}`, status: 'inbox' } })
  }
  return { id: user.id, email, session }
}
async function pay(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const choice = page.locator('#payment-method-label-card')
  if (await choice.count()) await choice.click({ force: true })
  await page.locator('#cardNumber, [name="cardNumber"], input[autocomplete="cc-number"]').first().fill('4242424242424242', { timeout: 45000 })
  await page.locator('#cardExpiry, [name="cardExpiry"], input[autocomplete="cc-exp"]').first().fill('1234')
  await page.locator('#cardCvc, [name="cardCvc"], input[autocomplete="cc-csc"]').first().fill('123')
  const name = page.locator('#billingName, [name="billingName"]').first(); if (await name.count()) await name.fill('ALPA Security Test')
  const country = page.locator('#billingCountry, [name="billingCountry"]').first(); if (await country.count()) await country.selectOption('CA').catch(() => {})
  const zip = page.locator('#billingPostalCode, [name="billingPostalCode"]').first(); if (await zip.count()) await zip.fill('H7N 1A1')
  await page.locator('.SubmitButton, button[type="submit"]').first().click()
  await page.waitForURL(`${BASE}/post-checkout**`, { timeout: 90000 })
}
const search = (u) => api(u, '/api/scrape', { method: 'POST', body: { query: 'dentists', defaultCity: 'Laval', maxLeads: 5, outputLeadLimit: 5 } })
const consumption = async (id) => JSON.stringify({
  usage: await rows('usage', `user_id=eq.${id}&select=leads_used,leads_limit&order=period_start`),
  runs: (await rows('ci_research_runs', `user_id=eq.${id}&select=run_id`)).length,
  queue: (await rows('commercial_intelligence_queue', `user_id=eq.${id}&select=id`)).length,
  leads: (await leadsOf(id)).length,
})

const state = {}
const browser = await chromium.launch({ headless: true, channel: 'chrome' })

await scenario('1  Account B cannot look up or activate Account A\'s checkout session, open or paid', async () => {
  const a = await account('a', { leads: 2 }); const b = await account('b', { leads: 1 })
  Object.assign(state, { a, b })
  const customer = await stripe('customers', { email: a.email, metadata: { user_id: a.id, phase: 'billing-security-test' } }, 'POST')
  await rest(`profiles?id=eq.${a.id}`, { method: 'PATCH', body: { stripe_customer_id: customer.id } })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies(sessionCookies(a.session))
  const page = await ctx.newPage()
  await page.goto(`${BASE}/checkout/start?plan=starter&source=security_test`)
  await page.waitForURL('https://checkout.stripe.com/**', { timeout: 60000 })
  const open = (await stripe('checkout/sessions', { customer: customer.id, limit: 5 })).data.find((s) => s.status === 'open')
  check(open, 'no open checkout session for A')
  state.sessionId = open.id
  const unknown = 'cs_test_doesnotexist_' + RUN
  const asB = async (path, body) => api(b, path, body ? { method: 'POST', body } : {})
  const sameAsUnknown = async (label, sessionId) => {
    const lookup = await asB(`/api/checkout/session?session_id=${sessionId}`), lookupUnknown = await asB(`/api/checkout/session?session_id=${unknown}`)
    const activate = await asB('/api/post-checkout/activate', { sessionId }), activateUnknown = await asB('/api/post-checkout/activate', { sessionId: unknown })
    check(lookup.status === 404 && activate.status === 404, `${label}: B got lookup ${lookup.status}, activate ${activate.status}`)
    check(lookup.text === lookupUnknown.text && activate.text === activateUnknown.text, `${label}: B's answer differs from the answer for an unknown id (it reveals the session exists)`)
    check(!JSON.stringify([lookup.json, activate.json]).includes(a.email), `${label}: A's email leaked`)
  }
  await sameAsUnknown('open session', open.id)
  const own = await api(a, '/api/post-checkout/activate', { method: 'POST', body: { sessionId: open.id } })
  check(own.status === 409, `A activating A's unpaid session answered ${own.status}`)
  check((await profileOf(b.id)).plan === 'free' && (await profileOf(a.id)).plan === 'free', 'a profile changed before payment')
  await pay(page, open.url)
  const paid = await waitFor(async () => { const p = await profileOf(a.id); return p.plan === 'starter_100' && p.plan_status === 'active' ? p : null }, { what: 'A activation', timeout: 90000 })
  state.aSubscription = paid.stripe_subscription_id
  const aBefore = JSON.stringify(await profileOf(a.id)), bBefore = JSON.stringify(await profileOf(b.id))
  await sameAsUnknown('paid session', open.id)
  check(JSON.stringify(await profileOf(b.id)) === bBefore && JSON.parse(bBefore).plan === 'free' && !JSON.parse(bBefore).stripe_subscription_id, 'B gained entitlement or a subscription')
  check(JSON.stringify(await profileOf(a.id)) === aBefore, 'A\'s profile changed after B\'s attempts')
  const subs = (await stripe('subscriptions', { customer: customer.id, status: 'all' })).data
  check(subs.length === 1 && subs[0].status === 'active', 'A does not have exactly one active subscription')
  const again = await api(a, '/api/post-checkout/activate', { method: 'POST', body: { sessionId: open.id } })
  check(again.status === 200, `A's own repeat activation answered ${again.status}`)
  await ctx.close()
  return 'B: lookup and activation 404, byte-identical to an unknown id, for the open and the paid session; B stays free with no subscription; A unchanged and still activates (200)'
})

await scenario('2  A signed-out caller cannot use any billing operation, and nothing is created in Stripe', async () => {
  const count = async () => `${(await stripe('checkout/sessions', { limit: 100 })).data.length}/${(await stripe('subscriptions', { status: 'all', limit: 100 })).data.length}`
  const before = await count()
  const garbage = { session: { access_token: 'not.a.token', refresh_token: 'x', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: crypto.randomUUID(), email: 'x@example.com' } } }
  const calls = [
    ['GET', '/api/auth/subscription'], ['GET', `/api/checkout/session?session_id=${state.sessionId}`],
    ['POST', '/api/checkout', { plan: 'starter', source: 'e2e' }], ['POST', '/api/checkout', { plan: 'pro', source: 'e2e' }],
    ['POST', '/api/post-checkout/activate', { sessionId: state.sessionId }],
    ['POST', '/api/billing/cancel', {}], ['POST', '/api/billing/resume', {}], ['POST', '/api/billing/change-plan', { plan: 'pro' }],
  ]
  const report = []
  for (const [method, path, body] of calls) {
    for (const who of [null, garbage]) {
      const r = await api(who, path, { method, body })
      check(r.status === 401, `${method} ${path} ${who ? 'with a forged session' : 'signed out'} answered ${r.status}`)
      check(!JSON.stringify(r.json).includes(state.a.email), `${path} leaked an email`)
    }
    report.push(`${method} ${path.split('?')[0]}`)
  }
  // /checkout/start is a page that asks /api/checkout (401 above) and then sends a signed-out visitor to the login form.
  const anonymous = await (await browser.newContext()).newPage()
  await anonymous.goto(`${BASE}/checkout/start?plan=starter&source=e2e`)
  await anonymous.waitForURL((u) => u.pathname === '/login', { timeout: 30000 })
  check(!/stripe\.com/.test(anonymous.url()) && /plan=starter/.test(anonymous.url()), `/checkout/start signed out ended at ${anonymous.url()}`)
  await anonymous.context().close()
  check((await count()) === before, 'a Stripe checkout session or subscription was created')
  const profile = JSON.stringify(await profileOf(state.a.id))
  check(JSON.parse(profile).plan === 'starter_100', 'A\'s plan changed')
  return `${report.length} operations x (signed out, forged session): 401; /checkout/start signed out lands on the login form with the plan kept; Stripe checkout sessions/subscriptions ${before} before and after`
})

await scenario('3  Stripe unreachable: paid discovery is refused for a paying and a free customer, nothing is consumed', async () => {
  const f = await account('free', { leads: 2 })
  state.f = f
  const before = { a: await consumption(state.a.id), f: await consumption(f.id) }
  await restartApp({ blockStripe: true })
  let attempts
  try {
    const sub = await api(state.a, '/api/auth/subscription')
    check(sub.status === 200 && sub.json.subscription.plan === 'starter_100', `display route under outage answered ${sub.status}`)
    const paid = await search(state.a), free = await search(f)
    for (const [label, r] of [['paying customer (webhook-synced)', paid], ['free customer', free]]) {
      check(r.status === 503 && /could not verify your subscription/.test(r.text), `${label}: search answered ${r.status} ${r.text.slice(0, 100)}`)
    }
    attempts = refusedStripeAttempts()
    check(attempts > 0, 'Stripe was not actually unreachable (no refused attempts recorded)')
    check(await consumption(state.a.id) === before.a && await consumption(f.id) === before.f, 'something was consumed, queued or saved during the outage')
  } finally { await restartApp({ blockStripe: false }) }
  const back = await search(state.a)
  check(!/could not verify your subscription/.test(back.text) && back.status !== 503, `after Stripe returned the search was still refused: ${back.status} ${back.text.slice(0, 100)}`)
  return `Stripe refused ${attempts} time(s); both searches 503 "could not verify your subscription"; usage, research runs, queue and businesses unchanged; after Stripe returned the paying customer's search was accepted (it stops at the missing provider key)`
})

await scenario('4  Webhook signature and replay, another customer\'s data, self-upgrade and operator functions', async () => {
  const hook = async (body, header) => (await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: header ? { 'stripe-signature': header } : {}, body })).status
  const sign = (payload, secret = process.env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`
  const prof = await profileOf(state.a.id)
  const sess = (await stripe('checkout/sessions', { customer: prof.stripe_customer_id, limit: 5 })).data.find((x) => x.status === 'complete')
  check(sess, 'no completed session for A')
  const event = JSON.stringify({ id: 'evt_sec_replay_' + RUN, object: 'event', type: 'checkout.session.completed', data: { object: sess } })
  check((await hook(event, null)) === 400, 'unsigned webhook accepted')
  check((await hook(event, sign(event, 'whsec_someoneelse'))) === 400, 'wrong-secret webhook accepted')
  check((await hook(event.replace(sess.id, 'cs_test_tampered'), sign(event))) === 400, 'tampered webhook accepted')
  check((await hook(event, sign(event, undefined, Math.floor(Date.now() / 1000) - 3600))) === 400, 'stale-timestamp webhook accepted')
  const before = JSON.stringify(await profileOf(state.a.id))
  const good = sign(event)
  check((await hook(event, good)) === 200 && (await hook(event, good)) === 200, 'a correctly signed event was refused')
  check(JSON.stringify(await profileOf(state.a.id)) === before, 'replaying the signed event changed the profile')
  const lead = (await leadsOf(state.a.id))[0]
  const peek = await api(state.b, `/api/my-leads/${lead.id}`)
  check(peek.status === 404, `B reading A's business answered ${peek.status}`)
  check(!JSON.stringify((await api(state.b, '/api/my-leads')).json).includes(lead.id), 'A\'s business appeared in B\'s list')
  const token = state.b.session.access_token
  const direct = async (path, init = {}) => { const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }); return { status: r.status, json: await r.json().catch(() => null) } }
  const rls = await direct(`leads?user_id=eq.${state.a.id}&select=id`)
  check(Array.isArray(rls.json) && rls.json.length === 0, 'row-level security exposed A\'s leads to B')
  const up = await direct(`profiles?id=eq.${state.b.id}`, { method: 'PATCH', body: JSON.stringify({ plan: 'pro' }) })
  check((await profileOf(state.b.id)).plan === 'free', `B changed their own plan (${up.status})`)
  const op = await direct('rpc/set_ci_research_enabled', { method: 'POST', body: JSON.stringify({ p_enabled: true, p_operator: 'x' }) })
  check(op.status >= 400, `B called an operator function (${op.status})`)
  const ctl = await rows('ci_research_controls', 'select=enabled,allow_all_customers')
  check(ctl[0].enabled === false && ctl[0].allow_all_customers === false, 'research controls changed')
  return 'unsigned / wrong secret / tampered / stale: 400; signed replay twice: 200 and no change; B reading A\'s business: 404 and empty under RLS; B cannot change their own plan or call an operator function; research controls untouched'
})

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`)
process.exit(failed.length ? 1 : 0)
