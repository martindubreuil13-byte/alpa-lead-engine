import assert from 'node:assert/strict'
import {register} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import test from 'node:test'
const ROOT=path.resolve(new URL('..',import.meta.url).pathname)
const server=pathToFileURL(path.join(ROOT,'tests/fixtures/guest/server.mjs')).href
const network=pathToFileURL(path.join(ROOT,'tests/fixtures/guest/network.mjs')).href
process.env.STRIPE_SECRET_KEY='sk_test_offline_fixture'
process.env.SUPABASE_SERVICE_ROLE_KEY='offline-fixture-key'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://offline.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='offline-fixture'
globalThis.fetch=async()=>{throw new Error('Network access is forbidden in the guest integration test')}
register('data:text/javascript,'+encodeURIComponent(`
const ROOT=${JSON.stringify(ROOT)}
export async function resolve(specifier,context,next) {
 if(['next/server','next/headers','@supabase/ssr','@/lib/guest/server'].includes(specifier))return {url:${JSON.stringify(server)},shortCircuit:true}
 if(['@/lib/sources/serper','@/lib/sources/google','@/lib/scraper/email-enrichment'].includes(specifier))return {url:${JSON.stringify(network)},shortCircuit:true}
 if(specifier.startsWith('@/'))specifier='file://'+ROOT+'/'+specifier.slice(2)
 try{return await next(specifier,context)}catch(e){if(['ERR_MODULE_NOT_FOUND','ERR_UNSUPPORTED_DIR_IMPORT'].includes(e.code)&&!/\\.\\w+$/.test(specifier))return next(specifier+'.ts',context);throw e}
}
`),pathToFileURL(ROOT+'/'))
const {POST:search}=await import('../app/api/scrape/route.ts')
const {GET:download}=await import('../app/api/guest/export/route.ts')
const {POST:claim}=await import('../app/api/guest/claim/route.ts')
const {state}=await import('./fixtures/guest/server.mjs')
const req=(url,body,origin='https://alpa.example')=>new Request('https://alpa.example'+url,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
test('real guest route → discovery engine → durable 25 businesses → email-only CSV, offline',async()=>{
 const response=await search(req('/api/scrape',{query:'businesses',defaultCity:'Toronto',maxLeads:25,existingLeadCount:0,guestTrial:true}))
 assert.equal(response.status,200)
 const events=(await response.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)))
 const leads=events.filter(event=>event.type==='lead').map(event=>event.payload)
 assert.equal(leads.length,25)
 assert.equal(state.leads.length,25)
 assert.ok(leads[0].website_intelligence.description)
 assert.equal(leads[24].email,null)
 assert.equal(leads[24].website,null)
 assert.ok(state.searchCalls>0)
 const csvResponse=await download(new Request('https://alpa.example/api/guest/export?email=a@b.com&leads=FORGED'))
 assert.equal(csvResponse.status,200)
 const csv=await csvResponse.text()
 assert.equal(csv.split('\n').length,26)
 assert.match(csv,/Offline Zebra Advisors/)
 assert.doesNotMatch(csv,/FORGED/)
 assert.equal(csvResponse.headers.get('Content-Disposition'),'attachment; filename="alpa-businesses.csv"')
 assert.equal(state.email,null,'no email is collected or stored for a download')
 assert.equal(state.marketing_opt_in,false)
 assert.equal(state.leads.length,25)
 state.user={id:'f418184a-7d53-49de-a560-24c571aabc28'}
 const claimed=await claim(req('/api/guest/claim',{leads:[{company_name:'FORGED'}]}))
 assert.equal(claimed.status,200)
 assert.equal(state.claimed.length,25)
 assert.equal(state.owner_user_id,state.user.id)
 assert.equal(state.leads.length,25)
 assert.ok(state.leads[0].website_intelligence)
 assert.equal(state.claimed[0].commercial_profile,undefined)
 state.user=null
 const priorCalls=state.searchCalls
 const blocked=await search(req('/api/scrape',{query:'businesses',defaultCity:'Toronto',maxLeads:25,existingLeadCount:0,guestSessionId:'new-browser-counter'}))
 assert.equal(blocked.status,429)
 assert.match(await blocked.text(),/"code":"GUEST_ALLOWANCE_USED"/,'the visitor is told the free allowance is used, not a generic refusal')
 assert.equal(state.searchCalls,priorCalls)
})
