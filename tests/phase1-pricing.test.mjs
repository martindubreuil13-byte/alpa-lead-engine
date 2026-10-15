import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { PLANS, entitlementForCheckout } from '../lib/billing/plans.ts'
import { decidePlanChange } from '../lib/billing/change-plan.ts'
const require = createRequire(import.meta.url)
function load(file, mocks = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name]
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, mocks)
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name.replace(/\.ts$/, '') + '.ts'), mocks)
    return require(name)
  }, module, module.exports)
  return module.exports
}
const calls = []
let price = { active: true, currency: 'usd', unit_amount: 999, type: 'recurring', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }
class Stripe {
  prices = { retrieve: async (id) => { calls.push(['price', id]); return price } }
  customers = {}
  checkout = { sessions: { create: async (payload) => { calls.push(['checkout', payload]); return { url: 'https://checkout.example' } } } }
}
const stripe = load('lib/stripe.ts', { stripe: { default: Stripe } })
process.env.STRIPE_STARTER_PRICE_ID = 'legacy500'
process.env.STRIPE_PROSPECTOR_PRICE_ID = 'legacy120'
process.env.STRIPE_ALPA_STARTER_PRICE_ID = 'new100'
process.env.STRIPE_ALPA_PRO_PRICE_ID = 'new500'

test('new entitlements and legacy allowances remain independent', () => {
  assert.deepEqual([PLANS.free.businesses, PLANS.starter_100.businesses, PLANS.pro.businesses], [25,100,500])
  assert.equal(PLANS.free.monthly, false)
  assert.equal(PLANS.starter.businesses, 500)
  assert.equal(PLANS.prospector.businesses, 120)
  assert.equal(entitlementForCheckout('starter'), 'starter_100')
  const usage = load('lib/usage/usage.ts')
  for (const [key, definition] of Object.entries(PLANS)) assert.equal(usage.getLeadLimit(key), definition.businesses)
  assert.equal(usage.getRemainingLeadCapacity(110, 'starter_100'), 0)
  assert.equal(usage.getRemainingLeadCapacity(100, 'pro'), 400)
})
test('price IDs map explicitly and unknown/missing prices never silently grant a plan', () => {
  for (const [id, plan] of [['new100','starter_100'],['new500','pro'],['legacy500','starter'],['legacy120','prospector']]) assert.equal(stripe.getPlanFromPriceId(id),plan)
  for (const id of [null, undefined, 'unknown']) assert.throws(() => stripe.getPlanFromPriceId(id), /Unrecognized/)
})
test('checkout validates monthly USD amount and never applies the preview discount', async () => {
  calls.length = 0
  await stripe.createStarterCheckoutSession({ origin:'http://localhost', customerId:'cus', userId:'user' })
  const payload = calls.find(([name]) => name === 'checkout')[1]
  assert.equal(payload.line_items[0].price,'new100')
  assert.equal(payload.discounts,undefined)
  assert.equal(await stripe.getConfiguredPrice('starter'),'new100')
  price = {...price,unit_amount:2499}
  assert.equal(await stripe.getConfiguredPrice('pro'),'new500')
  price = {...price,unit_amount:999}
  for (const over of [{unit_amount:2999},{currency:'cad'},{active:false},{recurring:{interval:'year',interval_count:1,usage_type:'licensed'}},{recurring:{interval:'month',interval_count:2,usage_type:'licensed'}}]) {
    const saved=price;price={...saved,...over};await assert.rejects(stripe.getConfiguredPrice('starter'),/does not match/);price=saved
  }
  process.env.STRIPE_ALPA_STARTER_PRICE_ID='legacy500'
  await assert.rejects(stripe.getConfiguredPrice('starter'),/distinct/)
  delete process.env.STRIPE_ALPA_STARTER_PRICE_ID
  await assert.rejects(stripe.getConfiguredPrice('starter'),/not configured/)
  process.env.STRIPE_ALPA_STARTER_PRICE_ID='new100'
})
test('upgrade and downgrade decisions preserve old contracts until reviewed', () => {
  assert.deepEqual(decidePlanChange('starter_100','pro'),{next:'pro',downgrade:false})
  assert.deepEqual(decidePlanChange('pro','starter'),{next:'starter_100',downgrade:true})
  for (const old of ['starter','prospector','free','admin']) assert.throws(() => decidePlanChange(old,'starter'),/reviewed migration/)
  assert.throws(() => decidePlanChange('pro','pro'),/already/)
})
let user={id:'owner'}
let sub
let synced=[]
const operations=[]
const liveStripe={
  subscriptions:{update:async(id,args)=>{operations.push(['upgrade',id,args]);return {...sub, pending_update:null}}},
  subscriptionSchedules:{retrieve:async(id)=>({id,metadata:{}}),create:async(args)=>{operations.push(['schedule',args]);return {id:'sched'}},update:async(id,args)=>{operations.push(['phases',id,args])}},
}
const route=load('app/api/billing/change-plan/route.ts',{
  'next/server':{NextResponse:{json:(body,{status=200}={})=>({body,status})}},
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user}})}})},
  '@/lib/stripe':{...stripe,getConfiguredPrice:async()=> 'validated-price'},
  '@/lib/stripe/subscription':{stripe:liveStripe,getActiveSubscription:async()=>({subscription:sub}),syncSubscriptionToDatabase:async(...args)=>synced.push(args)},
})
const post=(plan,origin='http://localhost')=>route.POST(new Request('http://localhost/api/billing/change-plan',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({plan})}))
function reset(id='new100') {operations.length=0;synced=[];sub={id:'sub',status:'active',items:{data:[{id:'item',price:{id},quantity:1,current_period_start:100,current_period_end:200}]}};process.env.ALPA_PLAN_CHANGES_ENABLED='true'}
test('plan-change endpoint is authenticated, same-origin and disabled until explicitly activated', async()=>{
  reset();user=null;assert.equal((await post('pro')).status,401);user={id:'owner'}
  assert.equal((await post('pro','https://foreign.example')).status,403)
  process.env.ALPA_PLAN_CHANGES_ENABLED='false';assert.equal((await post('pro')).status,503)
  assert.equal(operations.length,0)
})
test('upgrade modifies the existing item, waits for payment and preserves usage/billing anchor',async()=>{
  reset();assert.equal((await post('pro')).status,200)
  assert.equal(operations[0][0],'upgrade');assert.equal(operations[0][1],'sub')
  assert.equal(operations[0][2].payment_behavior,'pending_if_incomplete')
  assert.equal(operations[0][2].billing_cycle_anchor,'unchanged')
  assert.equal(operations[0][2].proration_behavior,'always_invoice')
  assert.equal(synced.length,1)
})
test('downgrade schedules renewal and leaves the current entitlement unchanged',async()=>{
  reset('new500');assert.equal((await post('starter')).status,200)
  const phases=operations.find(([name])=>name==='phases')[2].phases
  assert.equal(phases[0].items[0].price,'new500');assert.equal(phases[0].end_date,200)
  assert.equal(phases[1].start_date,200);assert.equal(phases[1].items[0].price,'validated-price')
  assert.equal(synced.length,0)
})
test('invalid, legacy and conflicting plan changes cannot modify Stripe',async()=>{
  reset();assert.equal((await post('admin')).status,400)
  reset('legacy500');assert.equal((await post('starter')).status,409)
  reset();sub.cancel_at_period_end=true;assert.equal((await post('pro')).status,409)
  reset();sub.schedule='existing';assert.equal((await post('pro')).status,409)
  assert.equal(operations.length,0)
})

test('a retry resumes its own downgrade schedule without creating another schedule',async()=>{
  reset('new500');sub.schedule='own-schedule'
  liveStripe.subscriptionSchedules.retrieve=async(id)=>({id,metadata:{alpa_plan_change:'true',user_id:'owner',target:'starter'}})
  assert.equal((await post('starter')).status,200)
  assert.equal(operations.filter(([name])=>name==='schedule').length,0)
  assert.equal(operations.filter(([name])=>name==='phases').length,1)
})

test('canceling a plan with our pending downgrade releases the schedule before canceling renewal', async()=>{
  const actions=[]
  class CancelStripe {
    subscriptionSchedules={
      retrieve:async()=>({subscription:'sub',metadata:{alpa_plan_change:'true'}}),
      release:async(id)=>actions.push(['release',id]),
    }
    subscriptions={update:async(id,args)=>{actions.push(['cancel',id,args]);return {id}}}
  }
  const billing=load('lib/stripe/subscription.ts',{'stripe':{default:CancelStripe},'@/lib/stripe':stripe})
  await billing.cancelSubscription('sub','schedule')
  assert.deepEqual(actions,[['release','schedule'],['cancel','sub',{cancel_at_period_end:true}]])
})
