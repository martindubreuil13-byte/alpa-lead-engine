import fs from 'node:fs'
import Stripe from 'stripe'
if(!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw new Error('TEST only')
const s=new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-02-25.clover'})
const customer=await s.customers.create({email:`alpa-scope-${Date.now()}@example.com`,metadata:{phase:'billing-test-readiness',scenario:'coupon-scope'}})
let result
try {
 const session=await s.checkout.sessions.create({mode:'subscription',customer:customer.id,line_items:[{price:process.env.STRIPE_STARTER_PRICE_ID,quantity:1}],discounts:[{promotion_code:process.env.STRIPE_FIRST_MONTH_PROMOTION_CODE_ID}],success_url:process.env.NEXT_PUBLIC_APP_URL+'/plans',cancel_url:process.env.NEXT_PUBLIC_APP_URL+'/plans'})
 result={testMode:!session.livemode,unrelatedLegacyPriceDiscount:session.total_details.amount_discount,amount:session.amount_total,restricted:session.total_details.amount_discount===0}
 await s.checkout.sessions.expire(session.id)
} catch(error){result={testMode:true,restricted:error.statusCode===400,reason:error.message}}
fs.writeFileSync('../../audit/billing-test/promotion-scope.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
