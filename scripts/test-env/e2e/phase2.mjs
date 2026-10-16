import fs from 'node:fs'
import crypto from 'node:crypto'
import {chromium} from 'playwright'
import Stripe from 'stripe'
import {BASE,PASSWORD,assertIsolated,authAdmin,check,createUser,guestCookie,leadsOf,profileOf,results,rest,rows,scenario as recordScenario,sessionCookies,signIn,sleep,waitFor} from './lib.mjs'
assertIsolated()
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-02-25.clover'})
const ONLY=process.env.PHASE2_ONLY?.split(',')
const previous=process.env.PHASE2_RESUME==='true'?JSON.parse(fs.readFileSync('../../audit/billing-test/phase2-state.private.json','utf8')):null
const scenario=(name,fn)=>!ONLY||ONLY.some(part=>name.includes(part))?recordScenario(name,fn):Promise.resolve()
const RUN=previous?.run??Date.now().toString(36)
const state={run:RUN,accounts:previous?.accounts??{},results}
const output='../../audit/billing-test'
const save=()=>fs.writeFileSync(output+'/phase2-state.private.json',JSON.stringify(state,null,2),{mode:0o600})
const browser=await chromium.launch({headless:true,channel:'chrome'})
const prices={starter:process.env.STRIPE_ALPA_STARTER_PRICE_ID,pro:process.env.STRIPE_ALPA_PRO_PRICE_ID}
async function api(u,path,body){const response=await fetch(BASE+path,{method:body?'POST':'GET',headers:{Cookie:sessionCookies(u.session).map(c=>`${c.name}=${c.value}`).join('; '),Origin:BASE,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()}}
async function pay(page,url){
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000})
 const choice=page.locator('#payment-method-label-card');if(await choice.count())await choice.click({force:true});else await page.getByText('Card',{exact:true}).first().click({force:true})
 await page.locator('#cardNumber, [name="cardNumber"], input[autocomplete="cc-number"]').first().fill('4242424242424242',{timeout:45000})
 await page.locator('#cardExpiry, [name="cardExpiry"], input[autocomplete="cc-exp"]').first().fill('1234')
 await page.locator('#cardCvc, [name="cardCvc"], input[autocomplete="cc-csc"]').first().fill('123')
 const name=page.locator('#billingName, [name="billingName"]').first();if(await name.count())await name.fill('ALPA Billing Test')
 const country=page.locator('#billingCountry, [name="billingCountry"]').first();if(await country.count())await country.selectOption('CA').catch(()=>{})
 const zip=page.locator('#billingPostalCode, [name="billingPostalCode"]').first();if(await zip.count())await zip.fill('H7N 1A1')
 await page.locator('.SubmitButton, button[type="submit"]').first().click()
 await page.waitForURL(BASE+'/post-checkout**',{timeout:90000})
 await page.waitForURL(BASE+'/dashboard**',{timeout:60000})
}
async function resumeCheckout(plan){
 const u=state.accounts[plan]
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});await ctx.addCookies(sessionCookies(u.session));const page=await ctx.newPage()
 const checkout=await stripe.checkout.sessions.retrieve(u.checkout)
 check(checkout.amount_total===(plan==='starter'?499:1249),'incorrect first-month total')
 if(!u.before){
  await rest('leads',{method:'POST',body:{user_id:u.id,company_name:`Preserved ${RUN} ${plan}`,phone:'15555550100',status:'inbox',light_profile:{version:1,summary:'Existing saved profile must survive billing.',tags:['Existing']}}})
  u.before=await leadsOf(u.id);save()
 }
 if(checkout.status!=='complete'){try{await pay(page,checkout.url)}catch(error){await page.screenshot({path:output+'/payment-error-'+plan+'.png',fullPage:true});fs.writeFileSync(output+'/payment-error-'+plan+'.private.txt',await page.locator('body').innerText(),{mode:0o600});throw error}}
 else {const activation=await api(u,'/api/post-checkout/activate',{sessionId:u.checkout});check(activation.status===200,'activation retry failed')}
 const profile=await waitFor(async()=>{const p=await profileOf(u.id);return p.plan===(plan==='starter'?'starter_100':'pro')&&p.plan_status==='active'?p:null},{what:'test activation'})
 u.subscription=profile.stripe_subscription_id;save()
 const subscription=await getSub(u)
 const invoice=await stripe.invoices.retrieve(typeof subscription.latest_invoice==='string'?subscription.latest_invoice:subscription.latest_invoice.id)
 check(invoice.status==='paid'&&invoice.amount_paid===(plan==='starter'?499:1249),'discounted invoice was not paid')
 check(JSON.stringify(await leadsOf(u.id))===JSON.stringify(u.before),'saved business/profile changed')
 u.firstInvoice=invoice.id;save();await ctx.close()
 return `${u.signup}; paid ${invoice.amount_paid} cents; activated ${profile.plan}; existing business/profile preserved`
}
const getSub=u=>stripe.subscriptions.retrieve(u.subscription)
const endOf=s=>s.items.data[0].current_period_end
async function advance(u,time){await stripe.testHelpers.testClocks.advance(u.clock,{frozen_time:time});await waitFor(async()=>{const c=await stripe.testHelpers.testClocks.retrieve(u.clock);return c.status==='ready'?c:null},{timeout:90000,what:'test clock ready'})}
async function provision(plan){
 if(state.accounts[plan])return resumeCheckout(plan)
 const addr=`alpa-phase2-${RUN}-${plan}@example.com`
 const ctx=await browser.newContext({viewport:{width:1280,height:900}})
 const page=await ctx.newPage()
 await page.goto(BASE+'/plans');await page.getByRole('button',{name:plan==='starter'?'Choose Starter':'Choose Pro',exact:true}).click()
 await page.waitForURL(`**/login?mode=signup&plan=${plan}&source=plans_${plan}`)
 await page.getByPlaceholder(/email/i).first().fill(addr);await page.locator('input[type="password"]').first().fill(PASSWORD)
 await page.getByRole('button',{name:'Create account',exact:true}).click();await sleep(3000)
 let user=(await authAdmin('users?per_page=300',null,'GET')).users.find(u=>u.email===addr)
 let signup='app sign-up succeeded'
 if(!user){user=await createUser(addr,{confirm:false});signup='app sign-up blocked by email delivery/rate limits; unconfirmed account created through TEST admin API'}
 const clock=await stripe.testHelpers.testClocks.create({frozen_time:Math.floor(Date.now()/1000),name:`ALPA phase2 ${RUN} ${plan}`})
 const customer=await stripe.customers.create({email:addr,test_clock:clock.id,metadata:{user_id:user.id,phase:'billing-test-readiness'}})
 await rest(`profiles?id=eq.${user.id}`,{method:'PATCH',body:{stripe_customer_id:customer.id}})
 const link=await authAdmin('generate_link',{type:'signup',email:addr,password:PASSWORD,redirect_to:BASE})
 await page.goto(link.action_link);await sleep(1200)
 const session=await signIn(addr)
 const u={id:user.id,email:addr,session,clock:clock.id,customer:customer.id,plan,signup}
 state.accounts[plan]=u;save()
 await page.context().addCookies(sessionCookies(session))
 // Continue the choice preserved during the actual signup; account confirmation is completed with its real generated link.
 await page.goto(BASE+`/checkout/start?plan=${plan}&source=plans_${plan}`)
 await page.waitForURL('https://checkout.stripe.com/**',{timeout:60000})
 const sessions=await stripe.checkout.sessions.list({customer:customer.id,limit:5})
 const checkout=sessions.data.find(s=>s.status==='open');check(checkout,'no open checkout')
 u.checkout=checkout.id;save()
 check(checkout.amount_total===(plan==='starter'?499:1249),`first invoice amount ${checkout.amount_total}`)
 check(checkout.total_details.amount_discount===(plan==='starter'?500:1250),'incorrect 50% discount rounding')
 await rest('leads',{method:'POST',body:{user_id:u.id,company_name:`Preserved ${RUN} ${plan}`,phone:'15555550100',status:'inbox',light_profile:{version:1,summary:'Existing saved profile must survive billing.',tags:['Existing']}}})
 u.before=await leadsOf(u.id)
 await pay(page,checkout.url)
 const profile=await waitFor(async()=>{const p=await profileOf(u.id);return p.plan===(plan==='starter'?'starter_100':'pro')&&p.plan_status==='active'?p:null},{what:'test activation'})
 u.subscription=profile.stripe_subscription_id;save()
 const subscription=await getSub(u)
 check(!subscription.livemode&&subscription.items.data[0].price.id===prices[plan],'wrong active test subscription')
 check(JSON.stringify(await leadsOf(u.id))===JSON.stringify(u.before),'saved businesses changed')
 const invoice=await stripe.invoices.retrieve(typeof subscription.latest_invoice==='string'?subscription.latest_invoice:subscription.latest_invoice.id)
 check(invoice.status==='paid'&&invoice.amount_paid===(plan==='starter'?499:1249),'first invoice not paid at discounted amount')
 u.firstInvoice=invoice.id;save();await ctx.close()
 return `${signup}; paid ${invoice.amount_paid} cents; activated ${profile.plan}; existing business/profile preserved`
}
try {
 for(const plan of ['starter','pro']) await scenario(`signup-checkout-payment-activation ${plan}`,()=>provision(plan))
 for(const plan of ['starter','pro'])await scenario(`renewal full price ${plan}`,async()=>{
  const u=state.accounts[plan];check(u?.subscription,'initial checkout did not complete')
  const subscription=await getSub(u);await advance(u,endOf(subscription)+7200)
  const invoice=await waitFor(async()=>{const list=await stripe.invoices.list({customer:u.customer,subscription:u.subscription,limit:10});return list.data.find(i=>i.billing_reason==='subscription_cycle'&&i.status==='paid')},{timeout:90000,what:'renewal invoice paid'})
  check(invoice.amount_paid===(plan==='starter'?999:2499),`renewal charged ${invoice.amount_paid}`)
  u.renewalInvoice=invoice.id;save();return `paid ${invoice.amount_paid} cents; first-month discount did not repeat`
 })
 await scenario('promotion reuse refused by Stripe after cancellation',async()=>{
  const u=state.accounts.starter;check(u?.subscription,'needs Starter subscription')
  const cancel=await api(u,'/api/billing/cancel',{});check(cancel.status===200,'app cancellation failed')
  const resume=await api(u,'/api/billing/resume',{});check(resume.status===200,'app resume failed')
  await stripe.subscriptions.cancel(u.subscription)
  await waitFor(async()=>(await profileOf(u.id))?.plan==='free',{what:'cancellation webhook'})
  let refused=false
  try{await stripe.checkout.sessions.create({mode:'subscription',customer:u.customer,line_items:[{price:prices.starter,quantity:1}],discounts:[{promotion_code:process.env.STRIPE_FIRST_MONTH_PROMOTION_CODE_ID}],success_url:BASE+'/post-checkout?session_id={CHECKOUT_SESSION_ID}',cancel_url:BASE+'/plans'})}catch(error){refused=error.statusCode===400;u.reuseRejection=error.message}
  check(refused,'Stripe accepted repeat promotion')
  const retry=await api(u,'/api/checkout',{plan:'starter',source:'phase2_returning'})
  check(retry.status===200,'returning customer could not start regular checkout')
  const list=await stripe.checkout.sessions.list({customer:u.customer,limit:10});const open=list.data.find(s=>s.status==='open')
  check(open.amount_total===999&&open.total_details.amount_discount===0,'returning customer received introductory discount')
  await stripe.checkout.sessions.expire(open.id)
  check(JSON.stringify(await leadsOf(u.id))===JSON.stringify(u.before),'cancellation changed business data')
  save();return 'Stripe rejected forced reuse; ALPA returning checkout is full-price; cancellation/resumption preserved business/profile'
 })
 await scenario('Pro downgrade at renewal, Starter upgrade after payment, cancellation of schedule',async()=>{
  const u=state.accounts.pro;check(u?.subscription,'needs Pro subscription')
  const down=await api(u,'/api/billing/change-plan',{plan:'starter'});check(down.status===200&&down.body.scheduled,'downgrade failed: '+JSON.stringify(down))
  check((await profileOf(u.id)).plan==='pro','downgrade removed current access early')
  const current=await getSub(u);u.schedule=typeof current.schedule==='string'?current.schedule:current.schedule.id
  await advance(u,endOf(current)+7200)
  await waitFor(async()=>(await profileOf(u.id)).plan==='starter_100',{what:'scheduled downgrade webhook'})
  const next=await getSub(u);check(next.items.data[0].price.id===prices.starter,'downgrade price did not change')
  const up=await api(u,'/api/billing/change-plan',{plan:'pro'});check(up.status===200,'upgrade failed: '+JSON.stringify(up))
  await waitFor(async()=>(await profileOf(u.id)).plan==='pro',{what:'upgrade paid and synced'})
  const downAgain=await api(u,'/api/billing/change-plan',{plan:'starter'});check(downAgain.status===200,'second schedule failed')
  const cancelled=await api(u,'/api/billing/cancel',{});check(cancelled.status===200,'canceling scheduled downgrade failed')
  const final=await getSub(u);check(final.cancel_at_period_end&&!final.schedule,'schedule not released before cancellation')
  check(JSON.stringify(await leadsOf(u.id))===JSON.stringify(u.before),'plan changes changed business data')
  save();return 'downgrade retained Pro until renewal; Starter then activated; paid Pro upgrade succeeded; schedule-aware cancellation retained data'
 })
 await scenario('cancellation reaches Free at period end',async()=>{
  const u=state.accounts.pro;const subscription=await getSub(u)
  check(subscription.cancel_at_period_end,'needs scheduled cancellation')
  await advance(u,endOf(subscription)+7200)
  await waitFor(async()=>(await profileOf(u.id)).plan==='free',{what:'cancellation period end webhook'})
  check((await getSub(u)).status==='canceled','Stripe subscription did not end')
  check(JSON.stringify(await leadsOf(u.id))===JSON.stringify(u.before),'business data changed at cancellation')
  return 'app-scheduled cancellation ended on the billing date; webhook removed paid entitlement; business and profile retained'
 })
} finally {
 save();fs.writeFileSync(output+'/phase2-results.json',JSON.stringify({run:RUN,results,accounts:Object.fromEntries(Object.entries(state.accounts).map(([k,u])=>[k,{user:u.id,customer:u.customer,subscription:u.subscription,clock:u.clock,checkout:u.checkout,firstInvoice:u.firstInvoice,renewalInvoice:u.renewalInvoice,signup:u.signup,reuseRejection:u.reuseRejection}]))},null,2));await browser.close()
}
process.exit(results.some(r=>!r.ok)?1:0)
