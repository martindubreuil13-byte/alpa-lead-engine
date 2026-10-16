import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import ts from 'typescript'
const calls=[]
let history=[],promotion,coupon
class FakeStripe {
 subscriptions={list:async()=>{calls.push('history');return {data:history}}}
 promotionCodes={retrieve:async()=>{calls.push('promotion');return promotion}}
 coupons={retrieve:async()=>{calls.push('coupon');return coupon}}
}
const code=ts.transpileModule(fs.readFileSync('lib/stripe.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const module={exports:{}}
new Function('require','module','exports',code)(name=>name==='stripe'?{default:FakeStripe}:{customerBelongsToUser:()=>true},module,module.exports)
const {getTestIntroduction}=module.exports
function reset(){calls.length=0;history=[];promotion={id:'promo_test',active:true,livemode:false,restrictions:{first_time_transaction:true},promotion:{type:'coupon',coupon:'coupon_test'}};coupon={id:'coupon_test',valid:true,livemode:false,percent_off:50,duration:'once'};process.env.ALPA_TEST_INTRO_OFFER_ENABLED='true';process.env.STRIPE_SECRET_KEY='sk_test_fixture';process.env.STRIPE_FIRST_MONTH_PROMOTION_CODE_ID='promo_test'}
test('the test offer is off by default and can never use a live key',async()=>{reset();delete process.env.ALPA_TEST_INTRO_OFFER_ENABLED;assert.equal(await getTestIntroduction('customer',true),null);assert.equal(calls.length,0);process.env.ALPA_TEST_INTRO_OFFER_ENABLED='true';process.env.STRIPE_SECRET_KEY='sk_live_fixture';await assert.rejects(getTestIntroduction('customer',true),/live key/);assert.equal(calls.length,0)})
test('stored prior-subscriber ineligibility and Stripe subscription history suppress introductory discounts',async()=>{reset();assert.equal(await getTestIntroduction('customer',false),null);assert.equal(calls.length,0);history=[{status:'canceled'}];assert.equal(await getTestIntroduction('customer',true),null);assert.deepEqual(calls,['history'])})
test('a first-time test customer gets the restricted promotion, not a reusable raw coupon',async()=>{reset();assert.equal(await getTestIntroduction('customer',true),'promo_test');assert.deepEqual(calls,['history','promotion','coupon'])})
test('recurring, live, inactive, unrestricted and wrong-percent promotions fail closed',async()=>{for(const kind of ['recurring','live','inactive','unrestricted','wrong-percent']){reset();if(kind==='recurring')coupon.duration='forever';if(kind==='live')promotion.livemode=true;if(kind==='inactive')promotion.active=false;if(kind==='unrestricted')promotion.restrictions.first_time_transaction=false;if(kind==='wrong-percent')coupon.percent_off=25;await assert.rejects(getTestIntroduction('customer',true),/Invalid/)}})
