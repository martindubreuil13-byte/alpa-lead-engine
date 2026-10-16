// The Stripe webhook: signatures are verified with Stripe's own code (offline, no network), unsigned or tampered requests change nothing,
// and each event type reaches the subscription sync. Not a delivery test: Stripe's servers are not involved.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import test from 'node:test'
import Stripe from 'stripe'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const WORLD = pathToFileURL(path.join(ROOT, 'tests/fixtures/billing/webhook-world.mjs')).href
const SECRET = 'whsec_offline_test_secret'
process.env.STRIPE_WEBHOOK_SECRET = SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_offline_fixture'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://offline.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline'
globalThis.fetch = async () => { throw new Error('Network access is forbidden in the webhook test') }
register('data:text/javascript,' + encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)}, WORLD=${JSON.stringify(WORLD)}
const MAP=new Set(['next/headers','@supabase/supabase-js','@/lib/stripe/subscription'])
export async function resolve(specifier,context,next) {
 if(MAP.has(specifier))return {url:WORLD,shortCircuit:true}
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`), pathToFileURL(ROOT + '/'))

const {hook, reset} = await import('./fixtures/billing/webhook-world.mjs')
const {POST} = await import('../app/api/stripe/webhook/route.ts')

const USER = '11111111-1111-4111-8111-111111111111'
const sub = (over = {}) => ({id: 'sub_1', customer: 'cus_1', status: 'active', ...over})
const event = (type, object) => ({id: `evt_${type}`, object: 'event', type, data: {object}})
async function send(evt, {secret = SECRET, tamper = false, unsigned = false, timestamp, keep = false} = {}) {
  if (!keep) reset()
  hook.subscriptions.set('sub_1', sub())
  const payload = JSON.stringify(evt)
  const headers = new Headers()
  if (!unsigned) headers.set('stripe-signature', Stripe.webhooks.generateTestHeaderString({payload, secret, timestamp}))
  hook.headers = headers
  const response = await POST(new Request('https://alpa.example/api/stripe/webhook', {method: 'POST', body: tamper ? payload.replace('cus_1', 'cus_2') : payload}))
  return response.status
}

test('a correctly signed checkout completion syncs that customer\'s subscription for the account named in the session', async () => {
  const status = await send(event('checkout.session.completed', {id: 'cs_1', customer: 'cus_1', subscription: 'sub_1', metadata: {user_id: USER, email: 'a@b.c', source: 'plans_featured'}}))
  assert.equal(status, 200)
  assert.deepEqual(hook.syncs, [{id: 'sub_1', userId: USER, customerId: 'cus_1'}])
  assert.equal(hook.analytics[0].event, 'payment_completed'); assert.equal(hook.analytics[0].user_id, USER)
})

test('a redelivered checkout completion is recorded once and still syncs safely', async () => {
  const evt = event('checkout.session.completed', {id: 'cs_9', customer: 'cus_1', subscription: 'sub_1', metadata: {user_id: USER}})
  assert.equal(await send(evt), 200)
  for (let i = 0; i < 3; i += 1) assert.equal(await send(evt, {keep: true}), 200)
  assert.equal(hook.analytics.filter((r) => r.event === 'payment_completed' && r.session_id === 'cs_9').length, 1, 'one analytics row for four deliveries')
  assert.equal(hook.syncs.length, 4, 'the subscription sync is idempotent and still runs each time')
  assert.equal(await send(event('checkout.session.completed', {id: 'cs_10', customer: 'cus_1', subscription: 'sub_1', metadata: {user_id: USER}}), {keep: true}), 200)
  assert.equal(hook.analytics.length, 2, 'a different session is a different payment')
})

test('requests Stripe did not sign change nothing: missing signature, wrong secret, tampered body, expired timestamp', async () => {
  const evt = event('checkout.session.completed', {id: 'cs_1', customer: 'cus_1', subscription: 'sub_1', metadata: {user_id: USER}})
  assert.equal(await send(evt, {unsigned: true}), 400); assert.equal(hook.syncs.length, 0)
  assert.equal(await send(evt, {secret: 'whsec_somebody_else'}), 400); assert.equal(hook.syncs.length, 0)
  assert.equal(await send(evt, {tamper: true}), 400); assert.equal(hook.syncs.length, 0)
  assert.equal(await send(evt, {timestamp: Math.floor(Date.now() / 1000) - 3600}), 400, 'a replayed old delivery is refused'); assert.equal(hook.syncs.length, 0)
  assert.equal(hook.analytics.length, 0)
})

test('a session metadata value that is not an account id is never used as one', async () => {
  assert.equal(await send(event('checkout.session.completed', {id: 'cs_1', customer: 'cus_1', subscription: 'sub_1', metadata: {user_id: "x'; drop table"}})), 200)
  assert.equal(hook.syncs[0].userId, null, 'the sync falls back to the Stripe customer link instead')
})

test('subscription changes, cancellations, paid invoices and failed payments all reach the sync', async () => {
  assert.equal(await send(event('customer.subscription.updated', sub({status: 'past_due'}))), 200); assert.equal(hook.syncs[0].id, 'sub_1')
  assert.equal(await send(event('customer.subscription.deleted', sub({status: 'canceled'}))), 200); assert.equal(hook.syncs.length, 1)
  assert.equal(await send(event('invoice.paid', {id: 'in_1', customer: 'cus_1', subscription: 'sub_1'})), 200); assert.equal(hook.syncs[0].id, 'sub_1')
  assert.equal(await send(event('invoice.payment_failed', {id: 'in_2', customer: 'cus_1', subscription: 'sub_1'})), 200); assert.equal(hook.syncs[0].id, 'sub_1')
  assert.equal(await send(event('invoice.paid', {id: 'in_3', customer: 'cus_9'})), 200); assert.deepEqual(hook.customerSyncs, ['cus_9'], 'no subscription on the invoice: the customer is re-synced')
})

test('events ALPA does not handle are acknowledged and ignored', async () => {
  assert.equal(await send(event('customer.created', {id: 'cus_1'})), 200)
  assert.equal(hook.syncs.length, 0); assert.equal(hook.customerSyncs.length, 0)
})

test('modern invoice parent subscription references reach renewal sync', async () => {
  assert.equal(await send(event('invoice.paid', {id:'in_modern',customer:'cus_1',parent:{type:'subscription_details',subscription_details:{subscription:'sub_1'}}})),200)
  assert.equal(hook.syncs[0].id,'sub_1')
  assert.equal(hook.customerSyncs.length,0)
})
