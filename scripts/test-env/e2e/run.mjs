#!/usr/bin/env node
// The twelve Stripe TEST-mode scenarios (see docs/stripe-test-environment.md). Run from the billing worktree with the private test
// environment sourced; it refuses to start otherwise. Only dedicated test accounts, Stripe test cards and the alpa-billing-test project.
import crypto from 'node:crypto'
import { chromium } from 'playwright'
import {
  BASE, PRICES, PASSWORD, assertIsolated, authAdmin, check, createUser, guestCookie, leadsOf, profileOf, results, rest, rows, scenario,
  sessionCookies, signIn, sleep, stripe, waitFor, webhookDeliveries,
} from './lib.mjs'

assertIsolated()
const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null
const want = (n) => !only || only.includes(n)
const RUN = Date.now().toString(36)
const email = (tag) => `alpa-billing-${RUN}-${tag}@example.com`
const state = { users: {}, sessions: {} }
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const contexts = []
async function newContext(cookies = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (cookies.length) await ctx.addCookies(cookies)
  contexts.push(ctx)
  return ctx
}
async function account(tag, { leads = 0 } = {}) {
  const addr = email(tag)
  const user = await createUser(addr)
  const session = await signIn(addr)
  state.users[tag] = { id: user.id, email: addr, session }
  for (let i = 0; i < leads; i += 1) {
    await rest('leads', { method: 'POST', body: { user_id: user.id, company_name: `Existing Biz ${tag}-${i}`, email: `biz${i}@${tag}.test`, website: `https://biz${i}.${tag}.test`, city: 'Laval', status: 'inbox', light_profile: i === 0 ? { version: 1, summary: `Saved profile for ${tag}.`, tags: ['Existing'], generated_at: new Date().toISOString(), model: 'gpt-4o-mini' } : null } })
  }
  return state.users[tag]
}
const cookiesOf = (tag) => sessionCookies(state.users[tag].session)
const api = async (tag, path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Cookie: cookiesOf(tag).map((c) => `${c.name}=${c.value}`).join('; '), 'Content-Type': 'application/json', Origin: BASE }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text }
}
async function payCheckout(page, url, addr) {
  await page.goto(url, { waitUntil: 'networkidle' })
  const cardChoice = page.locator('#payment-method-label-card')
  if (await cardChoice.count()) await cardChoice.click({ force: true })
  await page.waitForSelector('#cardNumber, [name="cardNumber"], input[autocomplete="cc-number"]', { timeout: 45000 })
  const num = page.locator('#cardNumber, [name="cardNumber"], input[autocomplete="cc-number"]').first()
  await num.fill('4242424242424242')
  await page.locator('#cardExpiry, [name="cardExpiry"], input[autocomplete="cc-exp"]').first().fill('1234')
  await page.locator('#cardCvc, [name="cardCvc"], input[autocomplete="cc-csc"]').first().fill('123')
  const name = page.locator('#billingName, [name="billingName"]').first()
  if (await name.count()) await name.fill('Billing Test')
  const zip = page.locator('#billingPostalCode, [name="billingPostalCode"]').first()
  if (await zip.count()) await zip.fill('H7N 1A1')
  const country = page.locator('#billingCountry, [name="billingCountry"]').first()
  if (await country.count()) await country.selectOption('CA').catch(() => {})
  void addr
  await page.locator('.SubmitButton, button[type="submit"]').first().click()
  await page.waitForURL(`${BASE}/post-checkout**`, { timeout: 90000 })
}

// ============================================================================================================== 1
const guestId = crypto.randomUUID()
const guestLeads = Array.from({ length: 8 }, (_, i) => ({
  id: crypto.randomUUID(), company_name: `Seeded Dental ${i + 1}`, city: 'Laval', industry: 'Dentist', email: `info${i + 1}@seeded-dental.test`, phone: `+1 450 555 01${String(i).padStart(2, '0')}`,
  website: `https://seeded-dental-${i + 1}.test`, status: 'inbox', source: 'serper', email_confidence: 'medium', email_source: 'website', is_generic_email: false, cost_estimate: 0, created_at: new Date().toISOString(),
  website_intelligence: { title: `Seeded Dental ${i + 1}`, description: `Family dental care number ${i + 1} in Laval with whitening and implants.`, headings: ['Teeth whitening', 'Dental implants'], source_urls: [`https://seeded-dental-${i + 1}.test/`] },
  ...(i === 0 ? { light_profile: { version: 1, summary: 'Seeded Dental 1 is a family dental clinic in Laval. According to its website, it offers teeth whitening and dental implants for children and adults across the city.', tags: ['Teeth whitening', 'Dental implants'], generated_at: new Date().toISOString(), model: 'gpt-4o-mini' } } : {}),
}))
if (want(1)) await scenario('1  Guest experience: seeded businesses, contacts, website facts and an AI profile are shown', async () => {
  await rest('guest_trials', { method: 'POST', body: { id: guestId, leads: guestLeads, used: 8, attempts: 1 } })
  const ctx = await newContext([guestCookie(guestId)])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/trial/results`)
  const list = page.locator('section[aria-label="Businesses"] > ul > li')
  await list.first().waitFor({ timeout: 60000 })
  check((await list.count()) === 8, `expected 8 rows, saw ${await list.count()}`)
  await page.getByRole('button', { name: /Seeded Dental 1\b/ }).first().click()
  await page.getByText(/is a family dental clinic in Laval/).waitFor({ timeout: 20000 })
  await page.getByText('View original website information').waitFor()
  await page.getByText('View original website information').click()
  await page.getByText('Family dental care number 1 in Laval with whitening and implants.').first().waitFor()
  check((await page.locator('a[href="mailto:info1@seeded-dental.test"]').count()) >= 1, 'contact email missing')
  const session = await (await ctx.request.get(`${BASE}/api/guest/session`)).json()
  check(session.leads.length === 8 && session.leads[0].light_profile?.tags?.length === 2, 'server record lost the profile')
  await page.close()
  return '8 businesses; AI profile + disclosure + contact + website facts shown'
})

// ============================================================================================================== 2 and 3
// The guest is the same browser context that holds the signed guest cookie. A real sign-up needs Supabase to send a confirmation email;
// the test project's built-in sender only delivers to team members, so the account is created with the admin API (unconfirmed) and the
// confirmation link is generated and followed, exactly what the email's button would do.
let guestCtx = null
if (want(2) || want(3)) await scenario('2+3  Account from the guest experience: plan chosen first, survives sign-up, email confirmation and sign-in; guest businesses transfer', async () => {
  guestCtx = await newContext([guestCookie(guestId)])
  const page = await guestCtx.newPage()
  // choose Prospector while signed out
  await page.goto(`${BASE}/plans`)
  await page.getByRole('button', { name: /Start Prospecting/ }).first().click()
  await page.waitForURL(/\/login\?mode=signup&plan=prospector&source=/, { timeout: 30000 })
  // real sign-up attempt through the app
  const addr = email('main')
  await page.getByPlaceholder(/email/i).first().fill(addr)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await sleep(4000)
  const uiMessage = (await page.locator('body').innerText()).split('\n').find((l) => /confirm|error|email|rate|sending|unable|fail/i.test(l) && l.length < 160 && !/email address|Continue/.test(l)) || ''
  const created = (await authAdmin('users?per_page=200', null, 'GET')).users.find((u) => u.email === addr)
  let note = 'real sign-up created the user'
  let user = created
  if (!user) {
    note = `the app sign-up did not create an account (page said: "${uiMessage.trim()}"); user created via the admin API, unconfirmed`
    user = await authAdmin('users', { email: addr, password: PASSWORD, email_confirm: false })
  }
  check(!user.email_confirmed_at, 'user should be unconfirmed before the link is followed')
  // sign-in before confirming must be refused
  const early = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addr, password: PASSWORD }) })
  check(early.status === 400, `an unconfirmed account must not sign in (got ${early.status})`)
  // follow the confirmation link
  const link = await authAdmin('generate_link', { type: 'signup', email: addr, password: PASSWORD, redirect_to: BASE })
  await page.goto(link.action_link)
  await sleep(2500)
  const confirmed = (await authAdmin(`users/${user.id}`, null, 'GET'))
  check(confirmed.email_confirmed_at, 'confirmation link did not confirm the account')
  // the pending plan survived in the browser; now sign in through the app
  const kept = await page.evaluate(() => window.localStorage.getItem('alpa_pending_checkout'))
  check(kept && JSON.parse(kept).plan === 'prospector', 'the chosen plan was lost')
  await page.goto(`${BASE}/login`)
  await page.getByPlaceholder(/email/i).first().fill(addr)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL(/checkout\.stripe\.com|\/checkout\/start/, { timeout: 60000 })
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 })
  state.users.main = { id: user.id, email: addr }
  state.users.main.session = await signIn(addr)
  state.mainCheckoutUrl = page.url()
  // guest businesses transferred
  const mine = await waitFor(async () => { const l = await leadsOf(user.id); return l.length >= 8 ? l : null }, { what: 'claimed leads' })
  check(mine.length === 8, `expected 8 transferred businesses, saw ${mine.length}`)
  const withProfile = mine.filter((l) => l.light_profile?.summary)
  check(withProfile.length === 1 && withProfile[0].light_profile.tags.length === 2, 'the saved AI profile did not transfer')
  check(mine.every((l) => l.website_facts?.title), 'website facts did not transfer')
  const trial = (await rows('guest_trials', `id=eq.${guestId}&select=owner_user_id`))[0]
  check(trial.owner_user_id === user.id, 'the trial was not linked to the account')
  const prof = await profileOf(user.id)
  check(prof?.plan === 'free', 'account must be free before payment')
  const price = new URL(page.url()).pathname
  void price; void note
  return `${note}; 8 businesses + 1 AI profile + website facts transferred; landed on Stripe checkout for the chosen plan`
})

// ============================================================================================================== 4 and 5
let mainSessionId = null
if (want(4) || want(5)) await scenario('4+5  Stripe test checkout, subscription activation and webhook sync', async () => {
  check(state.users.main, 'needs scenario 2+3 first')
  const u = state.users.main
  const page = await (await newContext()).newPage()
  // Prospector price on the Stripe session before paying
  const sessions = await stripe('checkout/sessions', { customer: (await profileOf(u.id)).stripe_customer_id, limit: 5 })
  const open = sessions.data.find((s) => s.status === 'open')
  check(open, 'no open Stripe checkout session for this account')
  mainSessionId = open.id
  check(open.metadata.user_id === u.id, 'the Stripe session is not stamped with the authenticated account')
  const items = await stripe(`checkout/sessions/${open.id}/line_items`)
  check(items.data[0].price.id === PRICES.prospector && items.data[0].amount_total === 999, 'wrong plan or price on the checkout session')
  const before = await profileOf(u.id)
  check(before.plan === 'free' && !before.stripe_subscription_id, 'access was granted before payment')
  // sign the browser in, then pay on Stripe's hosted page with the official test card
  await page.context().addCookies(sessionCookies(u.session))
  await payCheckout(page, open.url, u.email)
  // the return page activates and opens the dashboard
  await page.waitForURL(`${BASE}/dashboard**`, { timeout: 60000 })
  const after = await waitFor(async () => { const p = await profileOf(u.id); return p.plan === 'prospector' && p.plan_status === 'active' ? p : null }, { what: 'activation' })
  const sub = await stripe(`subscriptions/${after.stripe_subscription_id}`)
  check(sub.status === 'active' && sub.items.data[0].price.id === PRICES.prospector, 'Stripe subscription is not the active Prospector plan')
  const subs = await stripe('subscriptions', { customer: after.stripe_customer_id, status: 'all' })
  check(subs.data.length === 1, `expected exactly one subscription, saw ${subs.data.length}`)
  // webhook deliveries reached the app and were accepted
  const hooks = await waitFor(() => { const d = webhookDeliveries(); return d.some((x) => x.type === 'checkout.session.completed' && x.status === 200) ? d : null }, { timeout: 40000, what: 'webhook delivery' })
  check(hooks.every((h) => h.status === 200), `a webhook delivery was rejected: ${JSON.stringify(hooks.filter((h) => h.status !== 200))}`)
  // the app agrees (verified live) and the plan allowance is the Prospector one
  const subscription = await api('main', '/api/auth/subscription')
  check(subscription.json?.subscription?.plan === 'prospector' && subscription.json.subscription.verified === true, 'app does not report a verified Prospector plan')
  return `Prospector $9.99 session stamped to the account; free until paid; then active, one subscription, ${hooks.length} webhook deliveries all 200 (${[...new Set(hooks.map((h) => h.type))].join(', ')})`
})


// ============================================================================================================== helpers for 6 to 12
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
const restUser = async (token, path, init = {}) => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const text = await res.text(); let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json }
}
const subsOf = async (profile) => (await stripe('subscriptions', { customer: profile.stripe_customer_id, status: 'all' })).data
const snapshot = async (id) => JSON.stringify(await profileOf(id))
const payNewCheckout = async (tag, plan) => {
  const started = await api(tag, '/api/checkout', { method: 'POST', body: { plan, source: 'e2e' } })
  check(started.status === 200 && started.json?.url, `checkout did not start (${started.status} ${started.text.slice(0, 120)})`)
  const page = await (await newContext(cookiesOf(tag))).newPage()
  await payCheckout(page, started.json.url, state.users[tag].email)
  await page.waitForURL(`${BASE}/dashboard**`, { timeout: 60000 })
  await page.close()
  return started.json.url.split('/').find((x) => x.startsWith('cs_')) ?? null
}
const sessionIdFromUrl = (u) => (u.match(/cs_[A-Za-z0-9_]+/) || [null])[0]

// ============================================================================================================== 6
let outsider = null
if (want(6) && mainSessionId) await scenario('6  Session ownership: another account cannot look up or activate a completed session', async () => {
  outsider = await account('outsider', { leads: 2 })
  const mainBefore = await snapshot(state.users.main.id), outBefore = await snapshot(outsider.id)
  const mainSubs = (await subsOf(await profileOf(state.users.main.id))).length
  const look = await api('outsider', `/api/checkout/session?session_id=${mainSessionId}`)
  const unknown = await api('outsider', '/api/checkout/session?session_id=cs_test_doesnotexist')
  check(look.status === 404 && unknown.status === 404 && JSON.stringify(look.json) === JSON.stringify(unknown.json), `lookup: ${look.status}/${unknown.status}, answers must be identical`)
  const act = await api('outsider', '/api/post-checkout/activate', { method: 'POST', body: { sessionId: mainSessionId } })
  check(act.status === 404, `activation by another account answered ${act.status}`)
  check((await snapshot(outsider.id)) === outBefore, 'the other account was modified')
  check((await snapshot(state.users.main.id)) === mainBefore, 'the owner was modified')
  check((await subsOf(await profileOf(state.users.main.id))).length === mainSubs, 'subscription count changed')
  const signedOut = await fetch(`${BASE}/api/post-checkout/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: mainSessionId }) })
  check(signedOut.status === 401, `signed-out activation answered ${signedOut.status}`)
  return 'lookup and activation: 404 (same as an unknown id); nothing modified; signed-out: 401'
})

// ============================================================================================================== 7
if (want(7) && mainSessionId) await scenario('7  Duplicate activation: idempotent, no second subscription, nothing deleted, client flags ignored', async () => {
  const u = state.users.main
  const leadsBefore = JSON.stringify(await leadsOf(u.id)), profileBefore = await profileOf(u.id)
  for (let i = 0; i < 3; i += 1) {
    const r = await api('main', '/api/post-checkout/activate', { method: 'POST', body: { sessionId: mainSessionId, cleanWorkspace: true, leads: [{ company_name: 'INJECTED', email: 'x@y.z' }] } })
    check(r.status === 200, `activation #${i + 1} answered ${r.status}`)
  }
  const subs = await subsOf(profileBefore)
  check(subs.length === 1, `expected one subscription, saw ${subs.length}`)
  check(JSON.stringify(await leadsOf(u.id)) === leadsBefore, 'leads changed (deleted, imported or edited)')
  check(JSON.stringify(await profileOf(u.id)) === JSON.stringify(profileBefore), 'the profile changed on a repeat activation')
  const inj = await rows('leads', `user_id=eq.${u.id}&company_name=eq.INJECTED&select=id`)
  check(inj.length === 0, 'a client-supplied lead was imported')
  return '3 more activations (with cleanWorkspace:true and an injected lead): all 200, one subscription, 8 leads and the profile byte-identical'
})

// ============================================================================================================== 8
if (want(8)) await scenario('8  Existing customer with leads and a saved profile completes checkout; everything remains', async () => {
  const c = await account('existing', { leads: 5 })
  const before = JSON.stringify(await leadsOf(c.id))
  await payNewCheckout('existing', 'starter')
  const p = await waitFor(async () => { const x = await profileOf(c.id); return x.plan === 'starter' && x.plan_status === 'active' ? x : null }, { what: 'Starter activation' })
  const sub = await stripe(`subscriptions/${p.stripe_subscription_id}`)
  check(sub.items.data[0].price.id === PRICES.starter, 'not the Starter price')
  check(JSON.stringify(await leadsOf(c.id)) === before, 'existing businesses or profiles changed')
  const kept = (await leadsOf(c.id)).filter((l) => l.light_profile?.summary)
  check(kept.length === 1, 'the saved profile is gone')
  return 'Starter ($29.99) active; 5 existing businesses and the saved profile byte-identical'
})

// ============================================================================================================== 9
if (want(9)) await scenario('9  Abandoned checkout: no entitlement, no lost leads, the customer can retry', async () => {
  const d = await account('abandon', { leads: 3 })
  const before = JSON.stringify(await leadsOf(d.id))
  const first = await api('abandon', '/api/checkout', { method: 'POST', body: { plan: 'starter', source: 'e2e' } })
  check(first.status === 200 && first.json.url, 'checkout did not start')
  const page = await (await newContext(cookiesOf('abandon'))).newPage()
  await page.goto(first.json.url, { waitUntil: 'networkidle' })
  await page.close() // closed without paying
  const p = await profileOf(d.id)
  check(p.plan === 'free' && !p.stripe_subscription_id, 'entitlement appeared without payment')
  check((await subsOf(p)).length === 0, 'a subscription exists in Stripe without payment')
  check(JSON.stringify(await leadsOf(d.id)) === before, 'leads changed')
  const act = await api('abandon', '/api/post-checkout/activate', { method: 'POST', body: { sessionId: sessionIdFromUrl(first.json.url) } })
  check(act.status >= 400 && (await profileOf(d.id)).plan === 'free', `activating an unpaid session answered ${act.status}`)
  const again = await api('abandon', '/api/checkout', { method: 'POST', body: { plan: 'starter', source: 'e2e' } })
  check(again.status === 200 && again.json.url, 'the customer cannot retry')
  await stripe(`checkout/sessions/${sessionIdFromUrl(again.json.url)}/expire`, {}, 'POST').catch(() => null)
  return `unpaid session: profile free, no Stripe subscription, 3 leads intact, activation refused (${act.status}), retry gave a checkout again`
})

// ============================================================================================================== 10 and 11
if (want(10) || want(11)) {
  let e = null, session1 = null
  await scenario('10  Stale session: a superseded checkout session cannot replace the current subscription', async () => {
    e = await account('stale', { leads: 2 })
    session1 = await payNewCheckout('stale', 'starter')
    const p1 = await waitFor(async () => { const x = await profileOf(e.id); return x.plan === 'starter' && x.plan_status === 'active' ? x : null }, { what: 'first subscription' })
    session1 = session1 ?? null
    // end the first subscription at Stripe, then subscribe again on a new session
    await stripe(`subscriptions/${p1.stripe_subscription_id}`, {}, 'DELETE')
    await waitFor(async () => { const x = await profileOf(e.id); return x.plan === 'free' ? x : null }, { what: 'cancellation webhook' , timeout: 60000})
    const secondUrlSession = await payNewCheckout('stale', 'prospector')
    const p2 = await waitFor(async () => { const x = await profileOf(e.id); return x.plan === 'prospector' && x.plan_status === 'active' && x.stripe_subscription_id !== p1.stripe_subscription_id ? x : null }, { what: 'second subscription' })
    const sessions = (await stripe('checkout/sessions', { customer: p2.stripe_customer_id, limit: 10 })).data.filter((s) => s.status === 'complete')
    const old = sessions.find((s) => s.subscription === p1.stripe_subscription_id)
    check(old, 'could not find the first completed session')
    const before = JSON.stringify(await profileOf(e.id))
    const stale = await api('stale', '/api/post-checkout/activate', { method: 'POST', body: { sessionId: old.id } })
    check(stale.status === 409, `the stale session answered ${stale.status}, expected a refusal`)
    check(JSON.stringify(await profileOf(e.id)) === before, 'the current subscription changed')
    check((await profileOf(e.id)).stripe_subscription_id === p2.stripe_subscription_id, 'the profile no longer holds the current subscription')
    void secondUrlSession
    return `old session refused (${stale.json?.code}); profile still holds the newer Prospector subscription`
  })
  await scenario('11  Second subscription: a subscribed account cannot start another checkout', async () => {
    check(e, 'needs scenario 10')
    const p = await profileOf(e.id)
    const sessionsBefore = (await stripe('checkout/sessions', { customer: p.stripe_customer_id, limit: 20 })).data.length
    for (const plan of ['starter', 'prospector']) {
      const r = await api('stale', '/api/checkout', { method: 'POST', body: { plan, source: 'e2e' } })
      check(r.status === 409 && r.json?.code === 'already_subscribed', `${plan}: answered ${r.status} ${r.json?.code}`)
    }
    const sessionsAfter = (await stripe('checkout/sessions', { customer: p.stripe_customer_id, limit: 20 })).data.length
    check(sessionsAfter === sessionsBefore, 'Stripe was asked for another checkout session')
    check((await subsOf(p)).filter((x) => x.status === 'active').length === 1, 'more than one active subscription')
    return '409 already_subscribed for both plans; no new Stripe session; one active subscription'
  })
}

// ============================================================================================================== phase 4
if (want(13)) await scenario('P4  Webhook signature and replay, cross-customer access, client flags, self-upgrade', async () => {
  const hook = async (body, header) => (await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: header ? { 'stripe-signature': header } : {}, body })).status
  const sign = (payload, secret = process.env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`
  const main = state.users.main
  const prof = await profileOf(main.id)
  const sess = (await stripe('checkout/sessions', { customer: prof.stripe_customer_id, limit: 5 })).data.find((x) => x.status === 'complete')
  const event = JSON.stringify({ id: 'evt_e2e_replay', object: 'event', type: 'checkout.session.completed', data: { object: sess } })
  check((await hook(event, null)) === 400, 'unsigned webhook was accepted')
  check((await hook(event, sign(event, 'whsec_someoneelse'))) === 400, 'a webhook signed with the wrong secret was accepted')
  check((await hook(event.replace(sess.id, 'cs_test_tampered'), sign(event))) === 400, 'a tampered webhook was accepted')
  check((await hook(event, sign(event, undefined, Math.floor(Date.now() / 1000) - 3600))) === 400, 'a stale-timestamp (replayed) webhook was accepted')
  const profBefore = JSON.stringify(await profileOf(main.id)), subsBefore = (await subsOf(prof)).length
  const analyticsBefore = (await rows('activity_logs', `user_id=eq.${main.id}&event=eq.payment_completed&select=id`)).length
  const good = sign(event)
  check((await hook(event, good)) === 200 && (await hook(event, good)) === 200, 'a correctly signed event was refused')
  check(JSON.stringify(await profileOf(main.id)) === profBefore && (await subsOf(prof)).length === subsBefore, 'replaying the event changed the subscription or profile')
  const analyticsAfter = (await rows('activity_logs', `user_id=eq.${main.id}&event=eq.payment_completed&select=id`)).length
  // other customer's data
  const lead = (await leadsOf(main.id))[0]
  const peek = await api('outsider', `/api/my-leads/${lead.id}`)
  check(peek.status === 404, `another customer's business answered ${peek.status}`)
  const listing = await api('outsider', '/api/my-leads')
  check(!JSON.stringify(listing.json).includes(lead.id), "another customer's business appeared in a list")
  const token = state.users.outsider.session.access_token
  const direct = await restUser(token, `leads?user_id=eq.${main.id}&select=id`)
  check(Array.isArray(direct.json) && direct.json.length === 0, 'row-level security exposed another customer\'s leads')
  // self-upgrade and operator functions
  const up = await restUser(token, `profiles?id=eq.${state.users.outsider.id}`, { method: 'PATCH', body: JSON.stringify({ plan: 'starter' }) })
  check(up.status >= 400 && (await profileOf(state.users.outsider.id)).plan === 'free', `a customer could change their own plan (${up.status})`)
  const rpc = await restUser(token, 'rpc/set_ci_research_enabled', { method: 'POST', body: JSON.stringify({ p_enabled: true, p_operator: 'x' }) })
  check(rpc.status >= 400, `a customer could call an operator function (${rpc.status})`)
  const ctl = await rows('ci_research_controls', 'select=enabled,allow_all_customers')
  check(ctl[0].enabled === false && ctl[0].allow_all_customers === false, 'research controls changed')
  return `unsigned/wrong-secret/tampered/stale: 400; signed replay x2: 200 and no change (payment_completed analytics rows ${analyticsBefore} -> ${analyticsAfter}); other customer's lead 404, RLS empty; self-upgrade and operator RPC refused`
})

// ============================================================================================================== 12
async function restartApp({ blockStripe }) {
  try { process.kill(Number(fs.readFileSync('/private/tmp/claude-501/e2e/app.pid', 'utf8'))) } catch { /* already stopped */ }
  try { execSync("pkill -f 'next start' || true") } catch { /* none running */ }
  await sleep(2500)
  fs.writeFileSync('/private/tmp/claude-501/e2e/blocked.log', '')
  const log = fs.openSync('/private/tmp/claude-501/e2e/app.log', 'a')
  const child = spawn('npx', ['next', 'start', '-p', '3000'], { cwd: process.cwd(), detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...(blockStripe ? { NODE_OPTIONS: `--require ${process.cwd()}/tests/helpers/stripe-sandbox.cjs`, STRIPE_BLOCK_LOG: '/private/tmp/claude-501/e2e/blocked.log' } : {}) } })
  child.unref(); fs.writeFileSync('/private/tmp/claude-501/e2e/app.pid', String(child.pid))
  await waitFor(async () => (await fetch(`${BASE}/login`)).status === 200, { timeout: 60000, what: 'app restart' })
}
if (want(12)) await scenario('12  Stripe outage: My Leads stays up, plan unverified, paid search refused, no research, nothing consumed', async () => {
  const u = state.users.main
  const leadsBefore = (await leadsOf(u.id)).length
  const runsBefore = (await rows('ci_research_runs', `user_id=eq.${u.id}&select=run_id`)).length
  const queueBefore = (await rows('commercial_intelligence_queue', `user_id=eq.${u.id}&select=id`)).length
  const usageBefore = JSON.stringify(await rows('usage', `user_id=eq.${u.id}&select=leads_used,leads_limit`))
  await restartApp({ blockStripe: true })
  try {
    const page = await (await newContext(cookiesOf('main'))).newPage()
    const resp = await page.goto(`${BASE}/dashboard/my-leads`)
    check(resp.status() === 200, `My Leads answered ${resp.status()}`)
    await page.locator('section[aria-label="Businesses"] > ul > li').first().waitFor({ timeout: 60000 })
    check((await page.getByText(/server error occurred/i).count()) === 0, 'My Leads shows a server error')
    const list = await api('main', '/api/my-leads?view=all')
    check(list.status === 200 && list.json?.total === leadsBefore, `leads list: ${list.status} total ${list.json?.total}`)
    const sub = await api('main', '/api/auth/subscription')
    check(sub.status === 200 && sub.json.subscription.verified === false && sub.json.subscription.subscription_active === false, `subscription route under outage: ${sub.status} ${JSON.stringify(sub.json?.subscription && { v: sub.json.subscription.verified, a: sub.json.subscription.subscription_active })}`)
    check(sub.json.subscription.plan === 'prospector', 'the stored plan is not shown for display')
    const search = await api('main', '/api/scrape', { method: 'POST', body: { query: 'dentists', defaultCity: 'Laval', maxLeads: 5, outputLeadLimit: 5 } })
    check(search.status === 503 && /could not verify your subscription/.test(search.text), `a paid search under outage answered ${search.status}: ${search.text.slice(0, 120)}`)
    check((await rows('ci_research_runs', `user_id=eq.${u.id}&select=run_id`)).length === runsBefore, 'a research run was created')
    check((await rows('commercial_intelligence_queue', `user_id=eq.${u.id}&select=id`)).length === queueBefore, 'a research job was queued')
    check(JSON.stringify(await rows('usage', `user_id=eq.${u.id}&select=leads_used,leads_limit`)) === usageBefore, 'an allowance was consumed')
    check((await leadsOf(u.id)).length === leadsBefore, 'leads changed')
    const attempts = fs.readFileSync('/private/tmp/claude-501/e2e/blocked.log', 'utf8').trim().split('\n').filter(Boolean).length
    check(attempts > 0, 'Stripe was not actually unreachable (no refused attempts recorded)')
    return `Stripe refused ${attempts} time(s): My Leads 200 with all ${leadsBefore} businesses; plan shown, verified=false, not active; search 503 "could not verify your subscription"; 0 research runs/jobs; allowances unchanged`
  } finally { await restartApp({ blockStripe: false }) }
})


// ============================================================================================================== 12x  outage by account type
if (want(14)) await scenario('12x  Outage matrix: what a free, an unverifiable-paid and a webhook-synced paid account get while Stripe is unreachable', async () => {
  const future = new Date(Date.now() + 20 * 86400000).toISOString()
  const free = await account('free12', { leads: 2 })
  const legacy = await account('legacy12', { leads: 2 })
  const synced = await account('synced12', { leads: 2 })
  const paidFields = { plan: 'starter', plan_status: 'active', subscription_status: 'active', subscription_tier: 'starter', current_period_end: future.replace('Z', '') }
  await rest(`profiles?id=eq.${legacy.id}`, { method: 'PATCH', body: paidFields })
  await rest(`profiles?id=eq.${synced.id}`, { method: 'PATCH', body: { ...paidFields, stripe_customer_id: 'cus_synced_fake', stripe_subscription_id: 'sub_synced_fake' } })
  const counts = async (id) => JSON.stringify({ runs: (await rows('ci_research_runs', `user_id=eq.${id}&select=run_id`)).length, queue: (await rows('commercial_intelligence_queue', `user_id=eq.${id}&select=id`)).length, usage: await rows('usage', `user_id=eq.${id}&select=leads_used`), leads: (await leadsOf(id)).length })
  const refused = () => fs.readFileSync('/private/tmp/claude-501/e2e/blocked.log', 'utf8').trim().split('\n').filter(Boolean).length
  await restartApp({ blockStripe: true })
  const out = {}
  try {
    for (const [tag, acct] of [['free12', free], ['legacy12', legacy], ['synced12', synced]]) {
      const before = await counts(acct.id), a0 = refused()
      const sub = await api(tag, '/api/auth/subscription')
      const a1 = refused()
      const page = await (await newContext(cookiesOf(tag))).newPage()
      const my = await page.goto(`${BASE}/dashboard/my-leads`)
      await page.close()
      const search = await api(tag, '/api/scrape', { method: 'POST', body: { query: 'dentists', defaultCity: 'Laval', maxLeads: 5, outputLeadLimit: 5 } })
      const a2 = refused()
      out[tag] = { myLeads: my.status(), plan: sub.json?.subscription?.plan, verified: sub.json?.subscription?.verified, active: sub.json?.subscription?.subscription_active, stripeCallsForPage: a1 - a0, searchStatus: search.status, searchSaid: search.text.replace(/\s+/g, ' ').slice(0, 110), stripeCallsForSearch: a2 - a1, changed: (await counts(acct.id)) !== before }
    }
  } finally { await restartApp({ blockStripe: false }) }
  console.log('        ' + JSON.stringify(out, null, 1).replace(/\n/g, '\n        '))
  check(Object.values(out).every((o) => o.myLeads === 200), 'My Leads failed for an account type')
  check(out.free12.searchStatus === 503 && out.legacy12.searchStatus === 503, 'a search that needs live verification did not fail closed')
  check(out.legacy12.verified === false && out.legacy12.active === false, 'an unverifiable paid plan was treated as verified/active')
  check(out.synced12.searchStatus === 503, `a webhook-synced paying account's search was NOT refused (answered ${out.synced12.searchStatus}; Stripe was asked ${out.synced12.stripeCallsForSearch} times)`)
  return 'all fail closed'
})

await browser.close()
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed so far`)
process.exit(results.some((r) => !r.ok) ? 1 : 0)
