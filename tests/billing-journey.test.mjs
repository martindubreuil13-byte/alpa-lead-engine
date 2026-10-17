// The approved account-first journey, run through the REAL routes against an offline model of Stripe and the database
// (tests/fixtures/billing/world.mjs). This is not Stripe test mode: it proves ALPA's own logic, not Stripe's behaviour.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import test from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const world_url = pathToFileURL(path.join(ROOT, 'tests/fixtures/billing/world.mjs')).href
process.env.STRIPE_SECRET_KEY = 'sk_test_offline_fixture'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://offline.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline'
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the billing journey test') }
register('data:text/javascript,' + encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)}
const WORLD=${JSON.stringify(world_url)}
const MAP=new Set(['next/server','@supabase/supabase-js','@/lib/supabase/server','@/lib/stripe','@/lib/stripe/subscription','@/lib/auth/resolve-user-subscription'])
export async function resolve(specifier,context,next) {
 if(MAP.has(specifier))return {url:WORLD,shortCircuit:true}
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`), pathToFileURL(ROOT + '/'))

const {world, resetWorld, addUser, signIn, pay} = await import('./fixtures/billing/world.mjs')
const {POST: startCheckout} = await import('../app/api/checkout/route.ts')
const {GET: lookup} = await import('../app/api/checkout/session/route.ts')
const {POST: activate} = await import('../app/api/post-checkout/activate/route.ts')
const {POST: cancelSub} = await import('../app/api/billing/cancel/route.ts')
const {POST: resumeSub} = await import('../app/api/billing/resume/route.ts')
const {GET: subscriptionRoute} = await import('../app/api/auth/subscription/route.ts')
const {getUserProfile} = await import('../lib/auth/get-user-profile.ts')
const {isPaid} = await import('../lib/auth/access.ts')
const {isEntitledToAutomaticResearch} = await import('../lib/commercial-intelligence/research-entitlement.ts')

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333'
const post = (route, url, body) => route(new Request(`https://alpa.example${url}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body ?? {})}))
const startFor = async (plan = 'starter') => { const r = await post(startCheckout, '/api/checkout', {plan, source: 'plans_featured'}); return {status: r.status, body: await r.json()} }
const sessionIdOf = (url) => url.split('/').pop()
const claimedLeads = (owner) => Array.from({length: 4}, (_, i) => ({id: `l${owner}-${i}`, user_id: owner, company_name: `Business ${i}`, email: `b${i}@x.test`, light_profile: i === 0 ? {version: 1, summary: 'A saved AI profile.', tags: ['Service']} : null, website_facts: {title: `Site ${i}`}}))

test('1. a new account completes checkout and is activated', async () => {
  resetWorld(); addUser(A); signIn(A)
  const start = await startFor('starter')
  assert.equal(start.status, 200); assert.match(start.body.url, /checkout\.stripe\.test/)
  const sessionId = sessionIdOf(start.body.url)
  const session = world.sessions.get(sessionId)
  assert.equal(session.metadata.user_id, A, 'the session is stamped with the authenticated account, not an email from the request')
  assert.equal(world.profiles.get(A).stripe_customer_id, session.customer)
  assert.equal(world.profiles.get(A).plan, 'free', 'nothing is granted before payment')
  pay(sessionId)
  assert.deepEqual(await (await lookup(new Request(`https://alpa.example/api/checkout/session?session_id=${sessionId}`))).json(), {verified: true}, 'no email in the answer')
  const done = await post(activate, '/api/post-checkout/activate', {sessionId})
  assert.equal(done.status, 200)
  assert.equal(world.profiles.get(A).plan, 'starter_100'); assert.equal(world.profiles.get(A).plan_status, 'active')
})

test('2. an existing account with leads completes checkout; nothing is deleted or imported, whatever the browser sends', async () => {
  resetWorld(); addUser(B); signIn(B); world.leads = claimedLeads(B)
  const before = JSON.stringify(world.leads)
  const sessionId = sessionIdOf((await startFor('pro')).body.url)
  pay(sessionId)
  const done = await post(activate, '/api/post-checkout/activate', {sessionId, cleanWorkspace: true, leads: [{company_name: 'INJECTED', email: 'x@y.z'}]})
  assert.equal(done.status, 200)
  assert.equal(JSON.stringify(world.leads), before, 'every business, with its saved AI profile and website facts, is untouched')
  assert.equal(world.profiles.get(B).plan, 'pro')
})

test('3. another account cannot use or even look up that session', async () => {
  resetWorld(); addUser(A); addUser(C); signIn(A)
  const sessionId = sessionIdOf((await startFor()).body.url); pay(sessionId)
  signIn(C); await startFor() // C has a customer of its own
  const cBefore = JSON.stringify(world.profiles.get(C))
  const aBefore = JSON.stringify(world.profiles.get(A)) // Gap 1: capture A's state before any hijacking attempt
  const looked = await lookup(new Request(`https://alpa.example/api/checkout/session?session_id=${sessionId}`))
  assert.equal(looked.status, 404)
  const unknown = await lookup(new Request('https://alpa.example/api/checkout/session?session_id=cs_missing'))
  assert.equal(unknown.status, 404); assert.deepEqual(await looked.json(), await unknown.json(), 'a foreign session looks exactly like an unknown one')
  const stolen = await post(activate, '/api/post-checkout/activate', {sessionId})
  assert.equal(stolen.status, 404)
  // Gap 1: neither account's entitlement is wrongly changed
  assert.equal(JSON.stringify(world.profiles.get(C)), cBefore, "C gained nothing from the hijacking attempt")
  assert.equal(JSON.stringify(world.profiles.get(A)), aBefore, "A's entitlement is also unchanged after the hijacking attempt")
  assert.equal(world.syncCalls.length, 0, 'no subscription sync was triggered')
  signIn(null)
  assert.equal((await post(activate, '/api/post-checkout/activate', {sessionId})).status, 401, 'signed-out callers are refused')
  assert.equal((await lookup(new Request(`https://alpa.example/api/checkout/session?session_id=${sessionId}`))).status, 401)
  // Gap 1: A can still legitimately activate their own session after the failed hijacking attempts
  signIn(A)
  assert.equal((await post(activate, '/api/post-checkout/activate', {sessionId})).status, 200, 'A can still activate their own session')
  assert.equal(world.profiles.get(A).plan, 'starter_100', "A's plan is correctly activated")
  assert.equal(world.profiles.get(C).plan, 'free', "C remains free throughout")
})

test('4. a stale checkout session cannot replace the subscription the account has now', async () => {
  resetWorld(); addUser(A); signIn(A)
  const oldSession = sessionIdOf((await startFor()).body.url)
  const oldSub = pay(oldSession, {status: 'canceled', current_period_end: Math.floor(Date.now() / 1000) - 86400})
  // later the account subscribes again and is live
  const live = world.subscriptions.set('sub_live', {id: 'sub_live', customer: world.sessions.get(oldSession).customer, status: 'active', cancel_at_period_end: false, current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20, metadata: {plan: 'pro'}})
  Object.assign(world.profiles.get(A), {plan: 'pro', plan_status: 'active', stripe_subscription_id: 'sub_live', stripe_customer_id: world.sessions.get(oldSession).customer})
  const refused = await post(activate, '/api/post-checkout/activate', {sessionId: oldSession})
  assert.equal(refused.status, 409); assert.match((await refused.json()).code, /session_expired|session_superseded/)
  assert.equal(world.profiles.get(A).stripe_subscription_id, 'sub_live'); assert.equal(world.syncCalls.length, 0)
})

test('5. a subscribed account cannot start a second checkout', async () => {
  resetWorld(); addUser(A); signIn(A)
  const sessionId = sessionIdOf((await startFor()).body.url); pay(sessionId)
  assert.equal((await post(activate, '/api/post-checkout/activate', {sessionId})).status, 200)
  const created = world.stripeSessionsCreated
  const second = await startFor()
  assert.equal(second.status, 409); assert.equal(second.body.code, 'already_subscribed')
  assert.equal(world.stripeSessionsCreated, created, 'Stripe was never asked for a second session')
  signIn(null)
  assert.equal((await startFor()).status, 401, 'checkout needs a signed-in account')
})

test('6. activation is idempotent: repeating it changes nothing and creates no second subscription', async () => {
  resetWorld(); addUser(A); signIn(A)
  const sessionId = sessionIdOf((await startFor()).body.url); pay(sessionId)
  for (let i = 0; i < 3; i += 1) assert.equal((await post(activate, '/api/post-checkout/activate', {sessionId})).status, 200)
  assert.equal(world.subscriptions.size, 1)
  assert.deepEqual([...new Set(world.syncCalls.map((c) => c.subscriptionId))], [world.profiles.get(A).stripe_subscription_id])
  assert.equal(world.profiles.get(A).plan_status, 'active')
})

test('7. an abandoned or incomplete checkout grants nothing and erases nothing', async () => {
  resetWorld(); addUser(B); signIn(B); world.leads = claimedLeads(B)
  const before = JSON.stringify(world.leads)
  const sessionId = sessionIdOf((await startFor()).body.url) // never paid
  const refused = await post(activate, '/api/post-checkout/activate', {sessionId})
  assert.ok(refused.status >= 400)
  assert.equal(world.profiles.get(B).plan, 'free'); assert.equal(JSON.stringify(world.leads), before)
  const retry = await startFor() // the customer can simply try again
  assert.equal(retry.status, 200)
})

test('8. Stripe unreachable: pages still answer with the stored plan, and nothing paid is granted', async () => {
  resetWorld(); addUser(A, {plan: 'starter', plan_status: 'active', subscription_tier: 'starter', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', current_period_end: new Date(Date.now() + 864e5 * 10).toISOString()}); signIn(A)
  world.stripeDown = true
  const route = await subscriptionRoute()
  assert.equal(route.status, 200, 'the subscription route no longer fails with Stripe down')
  const payload = await route.json()
  assert.equal(payload.subscription.verified, false); assert.equal(payload.subscription.plan, 'starter'); assert.equal(payload.subscription.subscription_active, false)
  const profile = await getUserProfile()
  assert.equal(profile.plan_verified, false); assert.equal(profile.plan, 'starter')
  assert.equal(isPaid(profile), false, 'a stored plan unlocks nothing')
  assert.equal(isEntitledToAutomaticResearch(profile.plan_verified === false ? 'free' : profile.plan), false)
  world.stripeDown = false
  const live = await getUserProfile()
  assert.equal(live.plan_verified, true); assert.equal(isPaid(live), true, 'once Stripe answers, the verified plan applies')
})

test('9. Stripe unreachable during checkout fails cleanly and starts nothing', async () => {
  resetWorld(); addUser(A); signIn(A); world.stripeDown = true
  const result = await startFor()
  assert.equal(result.status, 500); assert.equal(world.stripeSessionsCreated, 0)
  assert.doesNotMatch(JSON.stringify(result.body), /Stripe|connection/i, 'no internal detail is shown')
})

test('10. (Gap 2) signed-out callers are refused on every protected billing operation', async () => {
  // A signed-out caller must receive 401 from every billing endpoint before any Stripe or database
  // write occurs. This regression closes the gap left by the static source checks in billing-security.test.mjs.
  resetWorld(); addUser(A); signIn(null)
  const sessionId = 'cs_hypothetical'
  assert.equal((await startFor()).status, 401, 'checkout start requires sign-in')
  assert.equal((await post(activate, '/api/post-checkout/activate', {sessionId})).status, 401, 'activation requires sign-in')
  assert.equal((await lookup(new Request(`https://alpa.example/api/checkout/session?session_id=${sessionId}`))).status, 401, 'session lookup requires sign-in')
  assert.equal((await cancelSub(new Request('https://alpa.example/api/billing/cancel', {method: 'POST'}))).status, 401, 'cancel requires sign-in')
  assert.equal((await resumeSub(new Request('https://alpa.example/api/billing/resume', {method: 'POST'}))).status, 401, 'resume requires sign-in')
  assert.equal(world.syncCalls.length, 0, 'no subscription was touched')
  assert.equal(world.stripeSessionsCreated, 0, 'Stripe was never asked')
})
