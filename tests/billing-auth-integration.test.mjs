// Real auth rules, client handover and server claim/checkout/activation/discovery routes; all external edges are offline fixtures.
import assert from 'node:assert/strict'
import { register } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
const ROOT=path.resolve(new URL('..',import.meta.url).pathname)
const WORLD=pathToFileURL(path.join(ROOT,'tests/fixtures/billing-auth/world.mjs')).href
const NETWORK=pathToFileURL(path.join(ROOT,'tests/fixtures/guest/network.mjs')).href
process.env.STRIPE_SECRET_KEY='sk_test_offline_fixture';process.env.NEXT_PUBLIC_SUPABASE_URL='https://offline.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='offline';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='offline'
register('data:text/javascript,'+encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)},WORLD=${JSON.stringify(WORLD)},NETWORK=${JSON.stringify(NETWORK)}
export async function resolve(specifier,context,next){
 if(['next/server','next/headers','@supabase/ssr','@supabase/supabase-js','@/lib/guest/server','@/lib/supabase/server','@/lib/supabase/admin','@/lib/stripe','@/lib/stripe/subscription'].includes(specifier))return {url:WORLD,shortCircuit:true}
 if(['@/lib/sources/serper','@/lib/sources/google','@/lib/scraper/email-enrichment'].includes(specifier))return {url:NETWORK,shortCircuit:true}
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`),pathToFileURL(ROOT+'/'))
const {world,resetWorld,addUser,signIn,pay}=await import('./fixtures/billing/world.mjs')
const {state}=await import('./fixtures/guest/server.mjs')
const live=await import('./fixtures/billing/stripe-world.mjs')
const {signupOptions,parseConfirmationLink,destinationAfterConfirmation}=await import('../lib/auth/email-confirmation.ts')
const {establishSessionFromLink}=await import('../lib/auth/password-reset.ts')
const {finishGuestHandOver}=await import('../lib/guest/claim-client.ts')
const {POST:claim}=await import('../app/api/guest/claim/route.ts')
const {POST:checkout}=await import('../app/api/checkout/route.ts')
const {POST:activate}=await import('../app/api/post-checkout/activate/route.ts')
const {POST:discover}=await import('../app/api/scrape/route.ts')
const USER='33333333-3333-4333-8333-333333333333'
const request=(url,body={})=>new Request('https://alpa.example'+url,{method:'POST',headers:{origin:'https://alpa.example','Content-Type':'application/json'},body:JSON.stringify(body)})
function reset(){
 resetWorld();live.reset();addUser(USER);signIn(null)
 Object.assign(state,{user:null,noCookie:false,expired:false,leads:[{id:'guest-1',company_name:'Guest original',phone:'15551',website:null,city:'Toronto',industry:'Services',light_profile:{version:1,summary:'Saved guest summary',tags:['Service']}}],existingLeads:[],otherTrials:[],updates:[],factsColumn:true,lightProfileColumn:true,claimError:false,lifetimeUsed:0,owner_user_id:undefined,claimed:undefined,searchCalls:0})
 const entries=new Map([['alpa_guest_trial_mode','1']]);globalThis.window={sessionStorage:{getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)}}
 globalThis.fetch=async url=>{if(url==='/api/guest/claim')return claim(request(url));throw new Error('External network forbidden: '+url)}
 return entries
}
for(const [plan,entitlement] of [['starter','starter_100'],['pro','pro']]){
 test(`${plan}: signup -> confirmation -> guest import -> checkout -> payment -> activation preserves saved businesses`,async()=>{
  const storage=reset()
  const options=signupOptions({plan,source:'plans_featured',emailRedirectTo:'https://alpa.example/auth/confirm'})
  assert.equal(world.profiles.get(USER).plan,'free')
  let token=null
  const auth={auth:{exchangeCodeForSession:async()=>{token='confirmed-session';signIn(USER);return {error:null}},getSession:async()=>({data:{session:token?{access_token:token,user:world.currentUser}:null},error:null})}}
  const link=parseConfirmationLink({search:'?code=local-confirmation-code',hash:''})
  assert.equal(await establishSessionFromLink(auth,link,{manualAfterMs:0,pollMs:1,timeoutMs:100}),'ready')
  const imported=await finishGuestHandOver();assert.equal(imported.imported,1);assert.equal(world.leads.length,1);assert.equal(storage.has('alpa_guest_trial_mode'),false)
  const before=JSON.stringify(world.leads)
  const destination=destinationAfterConfirmation({next:null,browserPending:null,userMetadata:options.data})
  assert.match(destination,new RegExp('plan='+plan))
  const start=await checkout(request('/api/checkout',{plan:new URL('https://alpa.example'+destination).searchParams.get('plan')}))
  assert.equal(start.status,200);assert.equal(world.profiles.get(USER).plan,'free')
  const sessionId=(await start.json()).url.split('/').pop();const paid=pay(sessionId);live.addSubscription(paid)
  assert.equal((await activate(request('/api/post-checkout/activate',{sessionId}))).status,200)
  assert.equal(world.profiles.get(USER).plan,entitlement);assert.equal(JSON.stringify(world.leads),before)
 })
}
test('failed import blocks continuation, retains guest mode/data, and retries without duplicating the business',async()=>{
 const storage=reset();signIn(USER);state.claimError=true
 await assert.rejects(finishGuestHandOver,/could not confirm/)
 assert.equal(storage.get('alpa_guest_trial_mode'),'1');assert.equal(world.leads.length,0);assert.equal(world.sessions.size,0)
 state.claimError=false;assert.equal((await finishGuestHandOver()).imported,1)
 assert.equal((await finishGuestHandOver()).imported,0);assert.equal(world.leads.length,1)
})
test('real discovery route and real resolver refuse a Stripe outage before quota accounting or provider requests',async()=>{
 reset();signIn(USER);live.addAccount(USER,{plan:'starter_100',subscription_tier:'starter_100',plan_status:'active',subscription_status:'active',stripe_customer_id:'cus_live',stripe_subscription_id:'sub_live'})
 addUser(USER,live.w.profiles.get(USER));live.w.down=true
 const before=JSON.stringify(world.leads),used=state.lifetimeUsed
 const response=await discover(request('/api/scrape',{query:'consultants',city:'Toronto',maxLeads:1}))
 assert.equal(response.status,503);assert.match(await response.text(),/nothing was used/);assert.ok(live.w.calls>0)
 assert.equal(state.lifetimeUsed,used);assert.equal(state.searchCalls,0);assert.equal(JSON.stringify(world.leads),before);assert.equal(world.sessions.size,0)
})
