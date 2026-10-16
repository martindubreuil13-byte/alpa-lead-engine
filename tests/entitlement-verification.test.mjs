// Paid actions must be confirmed with Stripe, never taken from the stored profile. This runs the REAL resolver and the REAL research
// entitlement rules against a fake Stripe that returns real Stripe errors; the earlier tests used a stand-in resolver that always asked
// Stripe, which is why they missed that a webhook-synced paying account was never checked.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const WORLD = pathToFileURL(path.join(ROOT, 'tests/fixtures/billing/stripe-world.mjs')).href
register('data:text/javascript,' + encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)}, WORLD=${JSON.stringify(WORLD)}
const MAP=new Set(['@/lib/stripe/subscription','@/lib/stripe'])
export async function resolve(specifier,context,next) {
 if(MAP.has(specifier))return {url:WORLD,shortCircuit:true}
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`), pathToFileURL(ROOT + '/'))

const { w, reset, addAccount, addSubscription, days } = await import('./fixtures/billing/stripe-world.mjs')
const { resolveUserSubscription } = await import('../lib/auth/resolve-user-subscription.ts')
const { verifyEntitlementLive } = await import('../lib/auth/paid-entitlement.ts')
const { isEntitledToAutomaticResearch } = await import('../lib/commercial-intelligence/research-entitlement.ts')
const { runBackgroundWorkerCore } = await import('../lib/commercial-intelligence/background-worker-core.ts')

const U = 'user-synced'
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const syncedPaying = (over = {}) => {
  addAccount(U, { plan: 'starter', plan_status: 'active', subscription_status: 'active', subscription_tier: 'starter', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', current_period_end: new Date(days(20) * 1000).toISOString().replace('Z', ''), ...over })
  w.customers.set('cus_1', { id: 'cus_1' })
}
// What a paid action does: confirm with Stripe, then derive the plan the way the search route does.
const paidAction = async (userId = U) => {
  const check = await verifyEntitlementLive(() => resolveUserSubscription(userId, { requireFresh: true }), { timeoutMs: 500 })
  if (!check.ok) return { allowed: false, refused: 'unavailable' }
  const plan = check.subscription.subscription_active ? check.subscription.plan : 'free'
  return { allowed: true, plan, research: isEntitledToAutomaticResearch(plan) }
}

test('the gap, reproduced: a webhook-synced paying account is answered from the database, Stripe is never asked, an outage changes nothing', async () => {
  reset(); syncedPaying(); addSubscription({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: days(20) })
  w.down = true
  const plain = await resolveUserSubscription(U, {})
  assert.equal(plain.plan, 'starter'); assert.equal(plain.subscription_active, true); assert.equal(w.calls, 0, 'the old path never asked Stripe')
})

test('1-3. paid customer with synced Stripe ids, Stripe unavailable: the paid action is refused', async () => {
  reset(); syncedPaying(); addSubscription({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: days(20) })
  w.down = true
  const result = await paidAction()
  assert.deepEqual(result, { allowed: false, refused: 'unavailable' })
  assert.ok(w.calls > 0, 'Stripe was asked and could not be reached')
  assert.equal(w.synced.length, 0, 'nothing was written')
})

test('4-7. automatic research cannot be authorized, no allowance is consumed, no job is queued, and the leads stay readable', async () => {
  reset(); syncedPaying(); addSubscription({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: days(20) })
  w.down = true
  const result = await paidAction()
  assert.equal(result.allowed, false) // the search route stops here: no capacity lookup, no discovery, no authorize_ci_research_run call
  const scrape = read('app/api/scrape/route.ts')
  const stop = scrape.indexOf('return createSseResponse(`❌ ${ENTITLEMENT_UNAVAILABLE_MESSAGE}`, 503)')
  assert.ok(stop > 0 && stop < scrape.indexOf('getDiscoverCapacity(createAdminClient()') && stop < scrape.indexOf('authorizeResearchRun(createAdminClient()'), 'the refusal comes before the allowance lookup and any research authorization')
  assert.match(scrape, /requireFresh: true/)
  // reading leads and the plan for display never needs Stripe
  assert.doesNotMatch(read('lib/my-leads/list.ts'), /stripe/i)
  const display = await resolveUserSubscription(U, { navigation: true })
  assert.equal(display.plan, 'starter', 'the stored plan can still be shown')
})

test('8-9. Stripe restored: a valid paid subscription searches again and is entitled to research', async () => {
  reset(); syncedPaying(); addSubscription({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: days(20) })
  w.down = true; assert.equal((await paidAction()).allowed, false)
  w.down = false
  assert.deepEqual(await paidAction(), { allowed: true, plan: 'starter', research: true })
  w.subscriptions.get('sub_1').items.data[0].price.id = 'price_prospector'
  assert.equal((await paidAction()).plan, 'prospector', 'the plan comes from Stripe, not the stored copy')
})

test('10. canceled or expired: no paid action after entitlement ends; canceled-but-paid-through still works while Stripe says so', async () => {
  reset(); syncedPaying(); addSubscription({ id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: days(-2) })
  assert.deepEqual(await paidAction(), { allowed: true, plan: 'free', research: false }, 'canceled and past its end date')
  reset(); syncedPaying(); addSubscription({ id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: days(9) })
  assert.deepEqual(await paidAction(), { allowed: true, plan: 'starter', research: true }, 'canceled but paid through: valid while Stripe confirms it')
  reset(); syncedPaying(); addSubscription({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true, current_period_end: days(5) })
  assert.equal((await paidAction()).research, true, 'set to end at the period end: still entitled until then')
  reset(); syncedPaying(); addSubscription({ id: 'sub_1', customer: 'cus_1', status: 'past_due', current_period_end: days(-1) })
  assert.equal((await paidAction()).research, false, 'past due and out of its paid period')
})

test('a stale "active" profile is not trusted: Stripe has no such subscription, so the account is not entitled', async () => {
  reset(); syncedPaying() // the database says active; Stripe knows nothing of sub_1 (cancellation webhook missed, or a copied profile)
  const result = await paidAction()
  assert.deepEqual(result, { allowed: true, plan: 'free', research: false })
})

test('free members and administrators', async () => {
  reset(); addAccount('free-user'); assert.deepEqual(await paidAction('free-user'), { allowed: true, plan: 'free', research: false })
  w.down = true; assert.equal((await paidAction('free-user')).allowed, false, 'a free member\'s search is also refused when Stripe cannot confirm anything')
  reset(); addAccount('owner', { plan: 'admin', plan_status: 'active' }); w.down = true
  const admin = await paidAction('owner')
  assert.deepEqual(admin, { allowed: true, plan: 'admin', research: true }); assert.equal(w.calls, 0, 'the administrator plan is internal: Stripe is not involved')
})

test('a hung Stripe is bounded: the paid action is refused after the timeout, not left waiting', async () => {
  const started = Date.now()
  const check = await verifyEntitlementLive(() => new Promise(() => {}), { timeoutMs: 80 })
  assert.deepEqual(check, { ok: false, reason: 'unavailable' }); assert.ok(Date.now() - started < 600)
})

test('the research retry route and the background worker use the same requirement', () => {
  const retry = read('app/api/research/runs/[runId]/retry/route.ts')
  assert.match(retry, /requireFresh: true/); assert.match(retry, /status: 503/); assert.match(retry, /status: 403/)
  assert.ok(retry.indexOf('requireFresh: true') < retry.indexOf('decideRetry('), 'confirmed before any retry decision')
  const worker = read('lib/commercial-intelligence/background-worker.ts')
  assert.match(worker, /verifyEntitlement:/); assert.match(worker, /requireFresh: true/)
  assert.equal((read('app/api/scrape/route.ts').match(/authorizeResearchRun\(/g) ?? []).length, 1, 'only one place authorizes research')
})

// ---- background jobs
const job = (n, user = U) => ({ id: `q${n}`, lead_id: `l${n}`, user_id: user, status: 'processing', retry_count: 0, max_retries: 1, created_at: '', started_at: '', completed_at: null, last_error: null, last_retry_at: null, claim_token: `t${n}` })
async function runWorker(verdict, jobs) {
  const calls = { enrich: 0, complete: [], verify: 0 }
  let handed = false
  const result = await runBackgroundWorkerCore({}, {
    claim: async () => { if (handed) return []; handed = true; return jobs },
    recover: async () => ({ resetCount: 0, failedCount: 0 }),
    enrich: async () => { calls.enrich += 1; return { success: true, ci_enrichment_status: 'completed', website_snapshot: {}, business_signals: {}, commercial_profile: { summary: 'x' }, ci_last_error: null, ci_cost_estimate: 0.0004 } },
    complete: async (_c, item, _s, _g, _p, success, error, cost) => { calls.complete.push({ id: item.id, success, error, cost }); return { ok: true, nextStatus: success ? 'enrichment_completed' : 'enrichment_failed' } },
    verifyEntitlement: async () => { calls.verify += 1; return verdict },
  }, { researchEnabled: true, batchSize: 5, concurrency: 1, maxRounds: 2 })
  return { calls, result }
}
test('background jobs: a customer who is no longer entitled, or cannot be confirmed, costs nothing and fetches nothing', async () => {
  for (const [verdict, reason] of [['not_entitled', 'entitlement_ended'], ['unavailable', 'entitlement_unverifiable']]) {
    const { calls } = await runWorker(verdict, [job(1), job(2)])
    assert.equal(calls.enrich, 0, `${verdict}: no research ran`)
    assert.deepEqual(calls.complete.map((c) => [c.success, c.error, c.cost]), [[false, reason, 0], [false, reason, 0]])
    assert.equal(calls.verify, 1, 'Stripe is asked once per customer per tick, not once per job')
  }
  const ok = await runWorker('entitled', [job(1), job(2)])
  assert.equal(ok.calls.enrich, 2); assert.ok(ok.calls.complete.every((c) => c.success))
})
