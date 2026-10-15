import fs from 'node:fs'
import Stripe from 'stripe'
const env=process.env
if(!env.STRIPE_SECRET_KEY?.startsWith('sk_test_')||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname!=='xkvraadbvfjlcohdpspg.supabase.co')throw new Error('Refusing non-isolated environment')
const stripe=new Stripe(env.STRIPE_SECRET_KEY,{apiVersion:'2026-02-25.clover'})
const account=await stripe.accounts.retrieve()
if(account.id!=='acct_1Ry8juAhk7C2xF8e')throw new Error('Unexpected Stripe account')
const products=await stripe.products.list({limit:100})
const result={account:account.id,testMode:true,plans:{}}
for(const [key,name,amount,businesses] of [['starter','ALPA Starter',999,100],['pro','ALPA Pro',2499,500]]){
 const lookup=`alpa_${key}_${businesses}_monthly_v1_test`
 let product=products.data.find(p=>p.metadata.alpa_billing_config===lookup)
 if(!product)product=await stripe.products.create({name,description:`${businesses} businesses per month`,metadata:{alpa_billing_config:lookup,phase:'billing-test-readiness'}},{idempotencyKey:lookup+':product'})
 if(product.livemode)throw new Error('Live product refused')
 const existing=await stripe.prices.list({lookup_keys:[lookup],limit:10})
 const price=existing.data[0]??await stripe.prices.create({product:product.id,currency:'usd',unit_amount:amount,recurring:{interval:'month'},lookup_key:lookup,metadata:{businesses:String(businesses),phase:'billing-test-readiness'}},{idempotencyKey:lookup+':price'})
 if(price.livemode||price.unit_amount!==amount||price.currency!=='usd'||price.recurring?.interval!=='month')throw new Error('Unexpected price')
 result.plans[key]={product:product.id,price:price.id,amount:price.unit_amount,currency:price.currency,businesses}
}
const couponId='ALPA_FIRST_MONTH_50_TEST_V1'
let coupon
try{coupon=await stripe.coupons.retrieve(couponId)}catch(e){if(e.statusCode!==404)throw e}
if(!coupon)coupon=await stripe.coupons.create({id:couponId,name:'ALPA 50% off first month — TEST',percent_off:50,duration:'once',applies_to:{products:Object.values(result.plans).map(p=>p.product)},metadata:{phase:'billing-test-readiness'}},{idempotencyKey:couponId})
if(coupon.livemode||coupon.percent_off!==50||coupon.duration!=='once')throw new Error('Unexpected coupon')
const codes=await stripe.promotionCodes.list({code:'ALPAFIRST50TEST',active:true,limit:10})
const promo=codes.data[0]??await stripe.promotionCodes.create({promotion:{type:'coupon',coupon:coupon.id},code:'ALPAFIRST50TEST',restrictions:{first_time_transaction:true},metadata:{phase:'billing-test-readiness'}},{idempotencyKey:'ALPA_FIRST_MONTH_50_TEST_V1:promotion'})
if(promo.livemode||!promo.restrictions.first_time_transaction)throw new Error('Unsafe promotion')
result.coupon={id:coupon.id,percentOff:coupon.percent_off,duration:coupon.duration,products:coupon.applies_to?.products ?? Object.values(result.plans).map(p=>p.product)}
result.promotion={id:promo.id,code:promo.code,firstTimeTransaction:promo.restrictions.first_time_transaction}
fs.mkdirSync('../../audit/billing-test',{recursive:true})
fs.writeFileSync('../../audit/billing-test/stripe-config.json',JSON.stringify(result,null,2))
const p='.env.stripe-test';let content=fs.readFileSync(p,'utf8')
const changes={STRIPE_ALPA_STARTER_PRICE_ID:result.plans.starter.price,STRIPE_ALPA_PRO_PRICE_ID:result.plans.pro.price,STRIPE_FIRST_MONTH_PROMOTION_CODE_ID:promo.id,ALPA_TEST_INTRO_OFFER_ENABLED:'true',ALPA_PLAN_CHANGES_ENABLED:'true',NEXT_PUBLIC_APP_URL:'http://localhost:3321'}
for(const [k,v]of Object.entries(changes)){const re=new RegExp(`^${k}=.*$`,'m');content=re.test(content)?content.replace(re,`${k}=${v}`):content+`\n${k}=${v}\n`}
fs.writeFileSync(p,content,{mode:0o600})
console.log(JSON.stringify(result,null,2))
