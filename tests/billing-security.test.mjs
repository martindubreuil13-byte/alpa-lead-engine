import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  checkSessionOwnership,
  customerBelongsToUser,
  decideActivation,
  decideNewCheckout,
} from '../lib/stripe/checkout-guard.ts'

const read = (file) => fs.readFileSync(file, 'utf8')
const flat = (file) => read(file).replace(/\s+/g, ' ')

const ME = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const session = (over = {}) => ({
  mode: 'subscription', status: 'complete', payment_status: 'paid',
  customer: 'cus_mine', subscription: 'sub_new', metadata: { user_id: ME }, ...over,
})
const own = (s, over = {}) => checkSessionOwnership(s, { userId: ME, profileCustomerId: 'cus_mine', ...over })

test('a session is accepted only for the account it was created for', () => {
  assert.equal(own(session()).ok, true)
})

test('another account cannot use a session: owner mismatch is refused as "not found"', () => {
  const r = checkSessionOwnership(session(), { userId: OTHER, profileCustomerId: 'cus_mine' })
  assert.equal(r.ok, false)
  assert.equal(r.status, 404)
  assert.equal(r.code, 'session_not_found')
})

test('ownership mismatches: no owner (legacy guest session), wrong customer, no profile customer, customer held by someone else', () => {
  assert.equal(own(session({ metadata: {} })).ok, false)
  assert.equal(own(session({ metadata: { user_id: '' } })).ok, false)
  assert.equal(own(session({ metadata: null })).ok, false)
  assert.equal(own(session({ customer: 'cus_other' })).ok, false)
  assert.equal(own(session({ customer: null })).ok, false)
  assert.equal(own(session(), { profileCustomerId: null }).ok, false)
  assert.equal(own(session(), { profileCustomerId: 'cus_other' }).ok, false)
  assert.equal(own(session(), { otherProfileHoldsCustomer: true }).ok, false)
  assert.equal(checkSessionOwnership(session(), { userId: '', profileCustomerId: 'cus_mine' }).ok, false)
})

test('an expanded customer object is read the same as an id', () => {
  assert.equal(own(session({ customer: { id: 'cus_mine' } })).ok, true)
})

test('a refused session reveals nothing that distinguishes "unknown" from "someone else\'s"', () => {
  const a = own(session({ metadata: { user_id: OTHER } }))
  const b = own(session({ customer: 'cus_other' }))
  assert.deepEqual(a, b)
})

test('activation: a complete session with a usable subscription for the same customer syncs', () => {
  const r = decideActivation({ session: session(), subscription: { id: 'sub_new', customer: 'cus_mine' }, subscriptionUsable: true, profile: { plan_status: 'free' } })
  assert.equal(r.ok, true)
})

test('activation is idempotent for the subscription the profile already holds (page reload, webhook arrived first)', () => {
  const r = decideActivation({ session: session(), subscription: { id: 'sub_new', customer: 'cus_mine' }, subscriptionUsable: true, profile: { stripe_subscription_id: 'sub_new', plan_status: 'active' } })
  assert.equal(r.ok, true)
})

test('session reuse: a stale session cannot overwrite a newer live subscription', () => {
  const r = decideActivation({ session: session(), subscription: { id: 'sub_old', customer: 'cus_mine' }, subscriptionUsable: true, profile: { stripe_subscription_id: 'sub_current', plan_status: 'active' } })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'session_superseded')
})

test('session reuse: an ended subscription from an old session cannot downgrade or replace the current one', () => {
  const r = decideActivation({ session: session(), subscription: { id: 'sub_old', customer: 'cus_mine' }, subscriptionUsable: false, profile: { stripe_subscription_id: 'sub_current', plan_status: 'active' } })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'session_expired')
})

test('a customer who canceled and re-subscribed may activate the new session', () => {
  const r = decideActivation({ session: session(), subscription: { id: 'sub_new', customer: 'cus_mine' }, subscriptionUsable: true, profile: { stripe_subscription_id: 'sub_old', plan_status: 'canceled' } })
  assert.equal(r.ok, true)
})

test('activation refuses incomplete sessions, missing subscriptions, and a subscription of a different customer', () => {
  const base = { subscription: { id: 'sub_new', customer: 'cus_mine' }, subscriptionUsable: true, profile: null }
  assert.equal(decideActivation({ ...base, session: session({ status: 'open' }) }).code, 'checkout_incomplete')
  assert.equal(decideActivation({ ...base, session: session({ payment_status: 'unpaid' }) }).code, 'checkout_incomplete')
  assert.equal(decideActivation({ ...base, session: session({ mode: 'payment' }) }).code, 'checkout_incomplete')
  assert.equal(decideActivation({ ...base, session: session(), subscription: null }).code, 'no_subscription')
  assert.equal(decideActivation({ ...base, session: session(), subscription: { id: 'sub_x', customer: 'cus_other' } }).ok, false)
})

test('duplicate subscriptions: a live Stripe subscription, a canceling one, or a live local record blocks a new checkout', () => {
  for (const input of [
    { profile: { plan: 'free' }, liveSubscription: { id: 'sub_1' } },
    { profile: { plan: 'starter', plan_status: 'active', stripe_subscription_id: 'sub_1' }, liveSubscription: null },
    { profile: { plan: 'prospector', plan_status: 'canceling', stripe_subscription_id: 'sub_1' }, liveSubscription: null },
    { profile: { plan: 'starter', plan_status: 'past_due', stripe_subscription_id: 'sub_1' }, liveSubscription: null },
  ]) {
    const r = decideNewCheckout(input)
    assert.equal(r.ok, false)
    assert.equal(r.status, 409)
    assert.equal(r.code, 'already_subscribed')
  }
})

test('free, never-subscribed and fully canceled customers can start a checkout; administrators cannot', () => {
  assert.equal(decideNewCheckout({ profile: null, liveSubscription: null }).ok, true)
  assert.equal(decideNewCheckout({ profile: { plan: 'free', plan_status: 'free' }, liveSubscription: null }).ok, true)
  assert.equal(decideNewCheckout({ profile: { plan: 'free', plan_status: 'canceled', stripe_subscription_id: 'sub_old' }, liveSubscription: null }).ok, true)
  assert.equal(decideNewCheckout({ profile: { plan: 'admin' }, liveSubscription: null }).code, 'admin_account')
})

test('a Stripe customer made for another account is never adopted', () => {
  assert.equal(customerBelongsToUser(OTHER, ME), false)
  assert.equal(customerBelongsToUser(ME, ME), true)
  assert.equal(customerBelongsToUser('', ME), true)
  assert.equal(customerBelongsToUser(undefined, ME), true)
})

// ---- the routes use the guard, and the dangerous behavior is gone ----

test('activation: authenticated, ownership-checked, session id only; no lead import, no workspace deletion, no service-role writes of client data', () => {
  const src = read('app/api/post-checkout/activate/route.ts')
  const f = flat('app/api/post-checkout/activate/route.ts')
  assert.match(f, /getUser\(\)/)
  assert.match(f, /status: 401/)
  assert.match(f, /checkSessionOwnership\(/)
  assert.match(f, /decideActivation\(/)
  assert.ok(f.indexOf('checkSessionOwnership(') < f.indexOf('syncSubscriptionToDatabase('), 'ownership is checked before any sync')
  assert.ok(f.indexOf('decideActivation(') < f.indexOf('syncSubscriptionToDatabase('))
  // credit bypass and destructive behavior removed
  assert.doesNotMatch(src, /cleanWorkspace/)
  assert.doesNotMatch(src, /\.delete\(/)
  assert.doesNotMatch(src, /\.insert\(/)
  assert.doesNotMatch(src, /\bleads\b.*\.from|\.from\(\s*['"]leads['"]/)
  assert.doesNotMatch(src, /enqueueLeadEnrichment|TrialLead|FREE_TRIAL_LEAD_LIMIT|body\??\.leads/)
  // only the session id is read from the body
  assert.match(f, /sessionId/)
  assert.doesNotMatch(src, /body\??\.(?!sessionId)\w+/)
  // the user comes from the session, never from the request
  assert.match(f, /syncSubscriptionToDatabase\(subscription, \{ userId: user\.id/)
})

test('session lookup: authentication required, ownership verified, and no email returned', () => {
  const src = read('app/api/checkout/session/route.ts')
  const f = flat('app/api/checkout/session/route.ts')
  assert.match(f, /getUser\(\)/)
  assert.match(f, /status: 401/)
  assert.match(f, /checkSessionOwnership\(/)
  assert.ok(f.indexOf('checkSessionOwnership(') < f.indexOf('verified:'), 'verified is only answered after the ownership check')
  assert.doesNotMatch(src, /getCheckoutEmail|email:/)
})

test('checkout creation: authenticated only, account and email from the session, duplicate guard before any Stripe call', () => {
  const src = read('app/api/checkout/route.ts')
  const f = flat('app/api/checkout/route.ts')
  assert.match(f, /getUser\(\)/)
  assert.match(f, /status: 401/)
  assert.match(f, /code: 'auth_required'/)
  // no identity from the body, no lookup of a user by email
  assert.doesNotMatch(src, /body\??\.email/)
  assert.doesNotMatch(src, /resolveCheckoutUserId|ilike\(|from\(\s*['"]users['"]/)
  assert.doesNotMatch(src, /body\??\.(user|customer)/i)
  assert.match(f, /const userId = user\.id/)
  assert.match(f, /user\.email\.trim\(\)\.toLowerCase\(\)/)
  // duplicate/admin guard runs before customer creation and session creation
  const guard = f.indexOf('decideNewCheckout(')
  assert.ok(guard > 0)
  assert.ok(guard < f.indexOf('createStripeCustomer('))
  assert.ok(guard < f.indexOf('CheckoutSession('))
  // the customer id written to the profile is the one resolved for this user's own profile
  assert.match(f, /customerId: profile\?\.stripe_customer_id/)
  assert.match(f, /\.upsert\(\{ id: userId, stripe_customer_id: customer\.id \}/)
})

test('Stripe customers are never rewritten across accounts, and checkout sessions are de-duplicated', () => {
  const f = flat('lib/stripe.ts')
  assert.match(f, /customerBelongsToUser\(existingCustomer\.metadata\?\.user_id/)
  assert.match(f, /idempotencyKey/)
})

test('the browser sends only what the server needs: no leads, no workspace flag, no email for identity', () => {
  const form = read('components/auth/PostCheckoutAccountForm.tsx')
  assert.doesNotMatch(form, /cleanWorkspace|getGuestLeads|signUp\(|leads:/)
  assert.match(form, /JSON\.stringify\(\{ sessionId: currentSessionId \}\)/)
  const button = flat('components/checkout/StartCheckoutButton.tsx')
  assert.match(button, /JSON\.stringify\(\{ source, plan \}\)/)
  assert.match(button, /res\.status === 401/)
  assert.match(button, /already_subscribed/)
})

test('legitimate flows are preserved: webhook, cancel and resume are untouched and still authenticated', () => {
  assert.match(read('app/api/stripe/webhook/route.ts'), /constructEvent\(/)
  for (const route of ['cancel', 'resume']) {
    assert.match(read(`app/api/billing/${route}/route.ts`), /getUser\(|getUserProfile/)
  }
})
