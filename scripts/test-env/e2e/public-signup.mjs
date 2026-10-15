import fs from 'node:fs'
import crypto from 'node:crypto'
import Stripe from 'stripe'
import {chromium} from 'playwright'
import {BASE,assertIsolated,authAdmin,guestCookie,rows,rest,profileOf,leadsOf,sessionCookies,waitFor,check} from './lib.mjs'
assertIsolated()
const email=process.env.ALPA_SIGNUP_TEST_EMAIL
check(email&&email.includes('@'),'controlled signup email required')
const directory=await authAdmin('users?per_page=300',null,'GET')
if(directory.users.some(u=>u.email?.toLowerCase()===email.toLowerCase())){console.log('CONTROLLED_EMAIL_ALREADY_EXISTS: preserved without changes');process.exit(2)}
const password=crypto.randomBytes(20).toString('base64url')+'!aA1'
const trial=crypto.randomUUID(),run=Date.now().toString(36)
const guestLeads=Array.from({length:3},(_,i)=>({id:crypto.randomUUID(),company_name:`Public signup ${run} ${i+1}`,phone:`15555551${i+10}`,email:null,website:`https://signup-${run}-${i}.example`,city:'Laval',source:'serper',status:'inbox',created_at:new Date().toISOString(),website_intelligence:{title:'Seeded signup test site',description:'Seeded website facts for billing continuity.',headings:[],source_urls:[`https://signup-${run}-${i}.example`]},...(i===0?{light_profile:{version:1,summary:'Seeded profile retained during signup and billing.',tags:['Test']}}:{})}))
await rest('guest_trials',{method:'POST',body:{id:trial,leads:guestLeads,used:3,attempts:1}})
const browser=await chromium.launch({headless:true,channel:'chrome'})
const context=await browser.newContext({viewport:{width:1280,height:900}})
await context.addCookies([guestCookie(trial)])
const page=await context.newPage()
try{
 await page.goto(BASE+'/plans');await page.getByRole('button',{name:'Choose Starter',exact:true}).click()
 await page.waitForURL('**/login?mode=signup&plan=starter&source=plans_starter')
 await page.getByPlaceholder(/email/i).first().fill(email);await page.locator('input[type="password"]').first().fill(password)
 const signupResponse=page.waitForResponse(r=>r.url().includes('/auth/v1/signup')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Create account',exact:true}).click()
 const response=await signupResponse;const data=await response.json()
 if(!response.ok()){const result={ok:false,stage:'public_signup',httpStatus:response.status(),code:data.code??data.error_code,message:data.msg??data.message??data.error_description};fs.writeFileSync('../../audit/billing-test/public-signup-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=1;}
 else {
  const user=data.user??data
  check(user.id,'public signup returned no account')
  fs.writeFileSync('../../audit/billing-test/public-signup-progress.private.json',JSON.stringify({user:user.id,email,password,trial,run}),{mode:0o600})
  // Preserve the real delivery boundary: the app sent the signup; the same confirmation action is exercised
  // using an admin-generated link so testing does not need access to the user's mailbox.
  const link=await authAdmin('generate_link',{type:'signup',email,password,redirect_to:BASE})
  await page.goto(link.action_link);await page.waitForTimeout(1000)
  const signInResponse=await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})})
  const session=await signInResponse.json();check(signInResponse.ok,'confirmed account could not sign in')
  await context.addCookies(sessionCookies(session))
  // Complete sign-in in the real UI, which also claims the guest trial before resuming checkout.
  await page.goto(BASE+'/login?plan=starter&source=plans_starter')
  await page.getByPlaceholder(/email/i).first().fill(email);await page.locator('input[type="password"]').first().fill(password)
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.waitForURL('https://checkout.stripe.com/**',{timeout:60000})
  const profile=await profileOf(user.id)
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-02-25.clover'})
  const sessions=await stripe.checkout.sessions.list({customer:profile.stripe_customer_id,limit:5})
  const checkout=sessions.data.find(s=>s.status==='open');check(checkout&&checkout.amount_total===499,'Starter choice/discount not carried through signup')
  const mine=await leadsOf(user.id);check(mine.length===3&&mine.some(l=>l.light_profile),'guest businesses/profile were not transferred')
  const card=page.locator('#payment-method-label-card');await card.waitFor({state:'visible',timeout:45000});await card.click({force:true})
  await page.locator('#cardNumber, [name="cardNumber"], input[autocomplete="cc-number"]').first().fill('4242424242424242')
  await page.locator('#cardExpiry, [name="cardExpiry"], input[autocomplete="cc-exp"]').first().fill('1234')
  await page.locator('#cardCvc, [name="cardCvc"], input[autocomplete="cc-csc"]').first().fill('123')
  const name=page.locator('#billingName, [name="billingName"]').first();if(await name.count())await name.fill('ALPA Public Signup Test')
  const country=page.locator('#billingCountry, [name="billingCountry"]').first();if(await country.count())await country.selectOption('CA').catch(()=>{})
  const zip=page.locator('#billingPostalCode, [name="billingPostalCode"]').first();if(await zip.count())await zip.fill('H7N 1A1')
  await page.locator('.SubmitButton, button[type="submit"]').first().click();await page.waitForURL(BASE+'/dashboard**',{timeout:90000})
  const activated=await waitFor(async()=>{const p=await profileOf(user.id);return p.plan==='starter_100'&&p.plan_status==='active'?p:null},{what:'public signup payment activation'})
  const cancel=await fetch(BASE+'/api/billing/cancel',{method:'POST',headers:{Cookie:sessionCookies(session).map(c=>`${c.name}=${c.value}`).join('; '),Origin:BASE}});check(cancel.ok,'test subscription cancellation schedule failed')
  const result={ok:true,user:user.id,checkout:checkout.id,subscription:activated.stripe_subscription_id,customer:activated.stripe_customer_id,publicSignup:true,signupStatus:response.status(),confirmation:'real signup dispatched confirmation; generated link followed; inbox delivery not independently verified',guestBusinesses:mine.length,savedProfilePreserved:true,plan:'starter_100',firstMonthCents:499,cancellationScheduled:true}
  fs.writeFileSync('../../audit/billing-test/public-signup-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
 }
}finally{await browser.close()}
