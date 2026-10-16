import fs from 'node:fs'
import Stripe from 'stripe'
import {BASE,assertIsolated,profileOf,leadsOf,sessionCookies,check,waitFor} from './lib.mjs'
assertIsolated()
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-02-25.clover'})
const state=JSON.parse(fs.readFileSync('../../audit/billing-test/phase2-state.private.json','utf8'))
const u=state.accounts.pro
const original=await stripe.subscriptions.retrieve(u.subscription)
const customer=await stripe.customers.retrieve(u.customer)
const pm=typeof original.default_payment_method==='string'?original.default_payment_method:original.default_payment_method?.id??customer.invoice_settings.default_payment_method
check(pm,'test payment method unavailable')
const sub=await stripe.subscriptions.create({customer:u.customer,items:[{price:process.env.STRIPE_ALPA_PRO_PRICE_ID}],default_payment_method:pm,payment_behavior:'error_if_incomplete',metadata:{phase:'billing-test-readiness',user_id:u.id}},{idempotencyKey:`alpa-final-cancel-${state.run}`})
await stripe.subscriptions.update(sub.id,{metadata:{billing_test_recovery:state.run}})
await waitFor(async()=>{const p=await profileOf(u.id);return p.plan==='pro'&&p.stripe_subscription_id===sub.id},{timeout:60000,what:'new full-price test subscription webhook'})
const response=await fetch(BASE+'/api/billing/cancel',{method:'POST',headers:{Cookie:sessionCookies(u.session).map(c=>`${c.name}=${c.value}`).join('; '),Origin:BASE}})
check(response.status===200,'app scheduled cancellation failed')
const scheduled=await stripe.subscriptions.retrieve(sub.id)
check(scheduled.cancel_at_period_end,'cancellation not scheduled')
await stripe.testHelpers.testClocks.advance(u.clock,{frozen_time:scheduled.items.data[0].current_period_end+7200})
await waitFor(async()=>(await stripe.testHelpers.testClocks.retrieve(u.clock)).status==='ready',{timeout:90000,what:'clock ready'})
await waitFor(async()=>(await profileOf(u.id)).plan==='free',{timeout:60000,what:'canceled entitlement removed'})
const ended=await stripe.subscriptions.retrieve(sub.id)
check(ended.status==='canceled','Stripe did not end subscription')
check(JSON.stringify(await leadsOf(u.id))===JSON.stringify(u.before),'saved business/profile changed')
const result={testMode:!ended.livemode,subscription:sub.id,customer:u.customer,clock:u.clock,status:ended.status,profilePlan:'free',savedDataPreserved:true,ok:true,detail:'App-scheduled cancellation reached period end; actual Stripe webhook removed paid entitlement and preserved the business/profile.'}
fs.writeFileSync('../../audit/billing-test/cancellation-final.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
