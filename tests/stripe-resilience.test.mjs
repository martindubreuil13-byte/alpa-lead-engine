// Stripe outage resilience: ordinary pages keep working and show a plan, nothing paid is granted from a stored plan, paid actions still
// verify live, and ordinary navigation does not call Stripe needlessly.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { isAdmin, isFree, isPaid } from '../lib/auth/access.ts'
import { getLocalSubscriptionState, shouldRefreshStripe } from '../lib/auth/stored-subscription.ts'
import { NAVIGATION_STRIPE_TIMEOUT_MS, resolveSubscriptionForNavigation } from '../lib/auth/subscription-display.ts'
import { isEntitledToAutomaticResearch } from '../lib/commercial-intelligence/research-entitlement.ts'

const read = (file) => fs.readFileSync(file, 'utf8')
const future = new Date(Date.now() + 20 * 86_400_000).toISOString()
const past = new Date(Date.now() - 20 * 86_400_000).toISOString()

const sub = (over = {}) => ({
  plan: 'starter', plan_status: 'active', subscription_active: true, cancel_at_period_end: false, current_period_end: future,
  stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_tier: 'starter', ...over,
})
// The profile getUserProfile builds from a resolved subscription (same fields, same rule).
const profileOf = (s) => ({ id: 'u', email: 'a@b.c', role: 'user', plan: s.plan, plan_status: s.plan_status, subscription_status: s.plan_status, cancel_at_period_end: s.cancel_at_period_end, current_period_end: s.current_period_end, subscription_tier: s.subscription_tier, subscription_active: s.subscription_active, plan_verified: s.verified, created_at: '2026-01-01T00:00:00Z' })
const nav = (deps) => resolveSubscriptionForNavigation({ timeoutMs: 60, ...deps })
const connectionFailure = () => Promise.reject(Object.assign(new Error('An error occurred with our connection to Stripe. Request was retried 2 times.'), { type: 'StripeConnectionError' }))

test('Stripe answers: the plan is verified and ordinary rules apply', async () => {
  const result = await nav({ resolveLive: async () => sub(), readStored: async () => { throw new Error('stored plan must not be read') } })
  assert.equal(result.verified, true)
  assert.equal(isPaid(profileOf(result)), true)
})

test('Stripe connection failure: the page still gets the stored plan to display, and nothing paid is granted', async () => {
  const reasons = []
  const result = await nav({ resolveLive: connectionFailure, readStored: async () => sub(), onFallback: (r) => reasons.push(r) })
  assert.deepEqual(reasons, ['error'])
  assert.equal(result.verified, false); assert.equal(result.plan, 'starter', 'the plan can still be shown')
  assert.equal(result.subscription_active, false)
  const profile = profileOf(result)
  assert.equal(isPaid(profile), false, 'a stored plan grants no paid access'); assert.equal(isFree(profile), true)
  assert.equal(isEntitledToAutomaticResearch(profile.plan_verified === false ? 'free' : profile.plan), false)
})

test('Stripe timeout: the page is not held longer than the bound, and the fallback is used', async () => {
  const reasons = []
  const started = Date.now()
  const result = await nav({ resolveLive: () => new Promise(() => {}), readStored: async () => sub(), timeoutMs: 80, onFallback: (r) => reasons.push(r) })
  const took = Date.now() - started
  assert.deepEqual(reasons, ['timeout']); assert.equal(result.verified, false)
  assert.ok(took >= 70 && took < 500, `answered after ${took}ms`)
  assert.ok(NAVIGATION_STRIPE_TIMEOUT_MS <= 3000, 'the production bound is a few seconds')
})

test('a canceled subscription never shows as paid-through, with Stripe up or down', async () => {
  const canceledStored = { id: 'u', plan: 'starter', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_status: 'canceled', plan_status: 'canceled', cancel_at_period_end: false, current_period_end: past, canceled_at: past, subscription_tier: 'starter' }
  const stored = getLocalSubscriptionState(canceledStored, 'starter')
  assert.equal(stored.plan, 'free'); assert.equal(stored.subscription_active, false)
  const down = await nav({ resolveLive: connectionFailure, readStored: async () => stored })
  assert.equal(isPaid(profileOf(down)), false)
  const live = await nav({ resolveLive: async () => sub({ plan: 'free', plan_status: 'canceled', subscription_active: false, subscription_tier: 'free', current_period_end: past }), readStored: async () => stored })
  assert.equal(live.verified, true); assert.equal(isPaid(profileOf(live)), false)
  const stillPaidThrough = getLocalSubscriptionState({ ...canceledStored, plan_status: 'canceling', subscription_status: 'canceling', cancel_at_period_end: true, current_period_end: future }, 'starter')
  assert.equal(stillPaidThrough.subscription_active, true, 'a subscription that ends at period end keeps its access until then (when verified)')
})

test('a stale stored plan cannot unlock anything: "active" in the database is not trusted when Stripe is unreachable', async () => {
  const stale = sub({ plan_status: 'active', current_period_end: past })
  const down = await nav({ resolveLive: connectionFailure, readStored: async () => stale })
  const profile = profileOf(down)
  assert.equal(profile.plan, 'starter', 'display fallback'); assert.equal(isPaid(profile), false)
  assert.equal(isAdmin(profile), false)
  // and the same stale row, verified live as canceled, is free
  const live = await nav({ resolveLive: async () => sub({ plan: 'free', plan_status: 'canceled', subscription_active: false, current_period_end: null, subscription_tier: 'free' }), readStored: async () => stale })
  assert.equal(isPaid(profileOf(live)), false)
})

test('the verified flag is the only thing that changes: admins and verified paying members are unaffected', () => {
  assert.equal(isPaid({ ...profileOf({ ...sub(), verified: true }) }), true)
  assert.equal(isPaid({ ...profileOf({ ...sub(), verified: true }), plan_verified: undefined }), true, 'older profiles without the flag behave as before')
  assert.equal(isAdmin({ ...profileOf({ ...sub({ plan: 'admin' }), verified: false }) }), true, 'admin comes from the database and never needed Stripe')
})

test('ordinary navigation does not call Stripe for a free member who was never linked to it; every other case still checks', () => {
  const free = { id: 'u', plan: 'free', stripe_customer_id: null, stripe_subscription_id: null, subscription_status: 'free', plan_status: 'free', cancel_at_period_end: false, current_period_end: null, canceled_at: null, subscription_tier: 'free' }
  assert.equal(shouldRefreshStripe(free, false, true), false, 'navigation: nothing to look up')
  assert.equal(shouldRefreshStripe(free, false, false), true, 'a paid action still looks it up')
  assert.equal(shouldRefreshStripe(free, true, true), true, 'forceRefresh always checks')
  assert.equal(shouldRefreshStripe({ ...free, stripe_customer_id: 'cus_1' }, false, true), true, 'a free member who has a Stripe customer is still checked')
  assert.equal(shouldRefreshStripe(null, false, true), true)
  const paid = { ...free, plan: 'starter', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', plan_status: 'active', subscription_status: 'active', subscription_tier: 'starter' }
  assert.equal(shouldRefreshStripe(paid, false, true), false, 'a paying member with a known subscription needs no call')
  assert.equal(shouldRefreshStripe({ ...paid, cancel_at_period_end: true, current_period_end: past }, false, true), true, 'an ended cancel-at-period-end subscription is re-checked')
})

test('wiring: pages degrade, paid actions stay live and fail closed, and nothing is weakened', () => {
  const profile = read('lib/auth/get-user-profile.ts')
  assert.match(profile, /resolveSubscriptionForNavigation/); assert.match(profile, /navigation: true/); assert.match(profile, /plan_verified: subscription\.verified/)
  const route = read('app/api/auth/subscription/route.ts')
  assert.match(route, /resolveSubscriptionForNavigation/)
  const scrape = read('app/api/scrape/route.ts')
  assert.match(scrape, /resolveUserSubscription\(user\.id, \{ email: user\.email \}\)/, 'discovery verifies live, with no navigation shortcut')
  assert.doesNotMatch(scrape, /resolveSubscriptionForNavigation|readStoredSubscription/)
  assert.match(scrape, /could not verify your subscription right now, so no search was started and nothing was used/)
  assert.match(scrape, /isEntitledToAutomaticResearch\(authenticatedPlan\)/)
  const access = read('lib/auth/access.ts')
  assert.match(access, /if \(user\.plan_verified === false\) return false/)
  for (const file of ['app/api/my-leads/route.ts', 'app/api/my-leads/[id]/route.ts', 'app/dashboard/my-leads/page.tsx']) {
    assert.match(read(file), /getUserProfile\(\)/, `${file} needs only a signed-in profile`)
    assert.doesNotMatch(read(file), /resolveUserSubscription|stripe/i, `${file} has no direct Stripe dependency`)
  }
})
