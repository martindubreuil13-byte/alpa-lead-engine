#!/usr/bin/env node
// A legacy Starter ($29.99, 500 businesses per month) subscription in Stripe TEST mode, against the isolated test project only.
// It is created through the Stripe API (the legacy price is no longer sold, so there is no checkout for it) and delivered to the app by
// the real webhook listener. Checks: the plan and 500 allowance are recognised, the subscription is untouched by new-plan checkout
// attempts (409, no new Stripe session), the allowance and guest-import paths treat it as paid, and a lapsed unlinked profile does not.
//   Needs the app on NEXT_PUBLIC_APP_URL and `stripe listen --forward-to localhost:3000/api/stripe/webhook` running.
import { BASE, PASSWORD, assertIsolated, authAdmin, check, createUser, profileOf, rest, rows, scenario, sessionCookies, signIn, sleep, stripe, waitFor, results } from './lib.mjs'

assertIsolated()
const RUN = Date.now().toString(36)
const legacyPrice = process.env.STRIPE_STARTER_PRICE_ID
const api = async (u, path, body) => {
  const res = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { Cookie: sessionCookies(u.session).map((c) => `${c.name}=${c.value}`).join('; '), Origin: BASE, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const rpc = async (name, body) => {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: k, Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`rpc ${name} ${res.status} ${text.slice(0, 160)}`)
  return JSON.parse(text)
}
const seedLeads = (userId, n) => rest('leads', { method: 'POST', body: Array.from({ length: n }, (_, i) => ({ user_id: userId, company_name: `Legacy ${RUN} ${i}`, phone: `1555${RUN}${i}`, status: 'inbox' })) })
const trial = async (n) => {
  const id = crypto.randomUUID()
  await rest('guest_trials', { method: 'POST', body: { id, leads: [{ company_name: `Guest ${RUN} ${n}`, phone: `1666${RUN}${n}` }] } })
  return id
}
const account = {}

await scenario('legacy Starter ($29.99) subscription is recognised through the real webhook and keeps 500 businesses', async () => {
  check(legacyPrice?.startsWith('price_'), 'STRIPE_STARTER_PRICE_ID missing')
  const price = await stripe(`prices/${legacyPrice}`)
  check(!price.livemode && price.unit_amount === 2999 && price.recurring?.interval === 'month', 'legacy test price is not $29.99 monthly')
  const email = `alpa-legacy-${RUN}@example.com`
  const user = await createUser(email)
  const customer = await stripe('customers', { email, metadata: { user_id: user.id, phase: 'legacy-starter-test' } }, 'POST')
  await rest(`profiles?id=eq.${user.id}`, { method: 'PATCH', body: { stripe_customer_id: customer.id } })
  const pm = await stripe('payment_methods/pm_card_visa/attach', { customer: customer.id }, 'POST')
  await stripe(`customers/${customer.id}`, { invoice_settings: { default_payment_method: pm.id } }, 'POST')
  const sub = await stripe('subscriptions', { customer: customer.id, items: { 0: { price: legacyPrice } }, metadata: { user_id: user.id } }, 'POST')
  check(sub.status === 'active', `legacy subscription is ${sub.status}`)
  const profile = await waitFor(async () => { const p = await profileOf(user.id); return p.plan === 'starter' && p.plan_status === 'active' ? p : null }, { what: 'webhook sync of legacy Starter', timeout: 90000 })
  const session = await signIn(email)
  Object.assign(account, { id: user.id, email, session, customer: customer.id, subscription: sub.id })
  check(profile.stripe_subscription_id === sub.id, 'subscription id not stored')
  const shown = await api(account, '/api/auth/subscription')
  check(shown.status === 200 && shown.json.subscription.plan === 'starter', `app shows ${JSON.stringify(shown.json?.subscription?.plan)}`)
  // the allowance the app applies for this plan
  const limit = (await import('node:fs')).readFileSync(new URL('../../../lib/billing/plans.ts', import.meta.url), 'utf8').match(/starter: \{[^}]*businesses: (\d+)/)?.[1]
  check(limit === '500', `legacy Starter allowance in code is ${limit}`)
  const capacity = await rpc('get_discover_capacity', { p_user_id: user.id, p_leads_limit: 500, p_monthly: true })
  check(capacity.leads_limit === 500 && capacity.leads_used === 0, `capacity ${JSON.stringify(capacity)}`)
  return 'plan starter / active, subscription linked by webhook, app shows starter, capacity window opens at 500'
})

await scenario('a new-plan checkout cannot touch the legacy subscription (409, no Stripe session, still one subscription)', async () => {
  check(account.id, 'needs the legacy account')
  const before = (await stripe('checkout/sessions', { customer: account.customer, limit: 20 })).data.length
  for (const plan of ['starter', 'pro']) {
    const r = await api(account, '/api/checkout', { plan, source: 'legacy-test' })
    check(r.status === 409 && r.json?.code === 'already_subscribed', `${plan}: answered ${r.status} ${r.json?.code}`)
  }
  check((await stripe('checkout/sessions', { customer: account.customer, limit: 20 })).data.length === before, 'a Stripe checkout session was created')
  const subs = (await stripe('subscriptions', { customer: account.customer, status: 'all' })).data
  check(subs.length === 1 && subs[0].id === account.subscription && subs[0].status === 'active' && subs[0].items.data[0].price.id === legacyPrice, 'the legacy subscription changed')
  const p = await profileOf(account.id)
  check(p.plan === 'starter' && p.plan_status === 'active', 'profile changed')
  return '409 already_subscribed for Starter and Pro; legacy subscription and profile unchanged'
})

await scenario('guest import: a linked legacy subscription imports past 25; a lapsed unlinked "active" profile gets the Free quota', async () => {
  await seedLeads(account.id, 25)
  const paid = await rpc('claim_guest_businesses', { p_user_id: account.id, p_trial_id: await trial(1), p_leads: [{ company_name: `Guest ${RUN} paid`, phone: `1777${RUN}1` }] })
  check(paid.imported === 1 && paid.skipped_allowance === 0, `legacy paid import ${JSON.stringify(paid)}`)
  const email = `alpa-lapsed-${RUN}@example.com`
  const lapsed = await createUser(email)
  await rest(`profiles?id=eq.${lapsed.id}`, { method: 'PATCH', body: { plan: 'starter', plan_status: 'active', subscription_status: 'active', stripe_subscription_id: null, current_period_end: '2026-05-04T14:49:17Z' } })
  await seedLeads(lapsed.id, 25)
  const free = await rpc('claim_guest_businesses', { p_user_id: lapsed.id, p_trial_id: await trial(2), p_leads: [{ company_name: `Guest ${RUN} lapsed`, phone: `1888${RUN}2` }] })
  check(free.imported === 0 && free.skipped_allowance === 1, `lapsed import ${JSON.stringify(free)}`)
  check((await rows('leads', `user_id=eq.${lapsed.id}&select=id`)).length === 25, 'existing businesses changed')
  const p = await profileOf(lapsed.id)
  check(p.plan === 'starter' && p.plan_status === 'active', 'lapsed profile was modified')
  return 'linked legacy subscription imported 1 beyond 25; lapsed unlinked profile imported 0 (Free quota), nothing modified'
})

await scenario('legacy cancellation reaches Free at period end and keeps the businesses', async () => {
  const cancel = await api(account, '/api/billing/cancel', {})
  check(cancel.status === 200, `cancel ${cancel.status}`)
  const kept = (await rows('leads', `user_id=eq.${account.id}&select=id`)).length
  await stripe(`subscriptions/${account.subscription}`, {}, 'DELETE')
  await waitFor(async () => (await profileOf(account.id)).plan === 'free' ? true : null, { what: 'cancellation webhook', timeout: 90000 })
  check((await rows('leads', `user_id=eq.${account.id}&select=id`)).length === kept, 'businesses removed')
  return 'cancel accepted; after the subscription ended the profile is free; all businesses kept'
})

const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} scenarios passed`)
process.exit(failed.length ? 1 : 0)
