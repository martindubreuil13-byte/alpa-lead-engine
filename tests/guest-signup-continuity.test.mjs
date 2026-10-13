// Phase 4: what ALPA learned about a guest's businesses survives signup, and signing up never adds free allowance.
// Real claim route, real search route, real dossier model: offline (no network, no database, no AI).
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
globalThis.fetch=async()=>{throw new Error('Network access is forbidden in this test')}
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
const {POST:claim}=await import('../app/api/guest/claim/route.ts')
const {state}=await import('./fixtures/guest/server.mjs')
const {guestDossierModel,memberDossierModel}=await import('../lib/my-leads/dossier-model.ts')
const {parseStoredWebsiteFacts,buildStoredWebsiteFacts}=await import('../lib/leads/stored-website-facts.ts')

const USER={id:'f418184a-7d53-49de-a560-24c571aabc28'}
const req=(url,body,origin='https://alpa.example')=>new Request('https://alpa.example'+url,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)})
const FREE_PROFILE=null
const lead=(i,over={})=>({id:`g-${i}`,company_name:`Guest Business ${i}`,city:'Laval',industry:'Dentist',email:`info@g${i}.ca`,phone:'+1 450 555 0100',website:`https://g${i}.ca`,email_confidence:'medium',is_generic_email:false,source:'serper',cost_estimate:0.01,email_source:`https://g${i}.ca/contact`,
 website_intelligence:{title:`Dental ${i}`,description:`Family dental care ${i}.`,headings:['Whitening','Implants'],source_urls:[`https://g${i}.ca/`]},email_inspection:{state:'checked',partial:i%2===0},created_at:'2026-10-13T00:00:00Z',...over})
function reset(over={}){
 Object.assign(state,{leads:[],used:0,email:null,existingLeads:[],profile:FREE_PROFILE,otherTrials:[],updates:[],factsColumn:true,expired:false,claimed:undefined,user:USER,owner_user_id:undefined,...over})
}
const run=async()=>{const r=await claim(req('/api/guest/claim',{leads:[{company_name:'FORGED'}]}));return {status:r.status,body:await r.json()}}

test('guest discovery → signup: every business arrives with its identifying details and all of its website facts, and no AI profile',async()=>{
 reset({user:null})
 const response=await search(req('/api/scrape',{query:'businesses',defaultCity:'Toronto',maxLeads:25,guestTrial:true}))
 await response.text()
 assert.equal(state.leads.length,25)
 state.user=USER
 const {status,body}=await run()
 assert.equal(status,200)
 assert.deepEqual([body.imported,body.skipped_invalid,body.skipped_duplicate,body.skipped_allowance],[25,0,0,0])
 assert.equal(state.claimed.length,25)
 state.claimed.forEach((row,i)=>{
  const guest=state.leads[i]
  for(const key of ['company_name','city','industry','website','email','phone'])assert.equal(row[key]??null,guest[key]??null,`${key} of business ${i}`)
  assert.equal(row.user_id,USER.id)
  // what is stored is the website's own words, nothing AI-written, and nothing the browser supplied
  for(const forbidden of ['commercial_profile','website_snapshot','business_signals','ci_enrichment_status'])assert.equal(forbidden in row,false,forbidden)
  const facts=guest.website_intelligence
  if(facts){
   assert.equal(row.website_facts.version,1);assert.equal(row.website_facts.origin,'free_trial')
   assert.equal(row.website_facts.title,facts.title);assert.equal(row.website_facts.description,facts.description)
   assert.deepEqual(row.website_facts.headings,facts.headings);assert.deepEqual(row.website_facts.source_urls,facts.source_urls)
  }else assert.equal('website_facts' in row,false,'nothing is stored when nothing was read')
 })
 assert.equal(state.owner_user_id,USER.id,'the trial is linked to the account')
})

test('what the guest saw is what the member sees: the website block is identical for all businesses, and kept apart from the AI profile',()=>{
 reset()
 const guests=[lead(1),lead(2,{website_intelligence:{title:'Only a title',description:null,headings:[],source_urls:['https://g2.ca/']}}),lead(3,{website_intelligence:null,email_inspection:{state:'unreadable',partial:false}}),lead(4,{website:null,website_intelligence:null,email_inspection:{state:'no_website',partial:false}})]
 for(const g of guests){
  const stored=parseStoredWebsiteFacts(JSON.parse(JSON.stringify(buildStoredWebsiteFacts(g)))) // through JSON, as the database keeps it
  const member=memberDossierModel({id:g.id,company_name:g.company_name,industry:g.industry,city:g.city,archived:false,status:null,pipeline_stage:null,notes:null,created_at:null,last_activity_at:null,source:null,website:stored,
   contact:{name:null,email:g.email,email_source:null,email_confidence:g.email_confidence,is_generic_email:false,phone:g.phone,website:g.website,source_url:null},
   intelligence:{state:'not_started',label:'Not generated',reason:null,researched_at:null,card:null,profile:null}})
  const guest=guestDossierModel(g)
  assert.deepEqual(member.what.site,guest.what.site,`${g.company_name}: the website facts survive signup unchanged`)
  assert.equal(member.what.ai,null,'no AI profile is invented')
  assert.deepEqual(member.contact.email,guest.contact.email);assert.deepEqual(member.who,guest.who)
  // the reason there is no AI profile is stated quietly, next to the website's own words
  if(member.what.site)assert.match(member.what.aiNote,/No business profile has been generated/)
 }
 assert.equal(buildStoredWebsiteFacts(lead(5,{website_intelligence:null,email_inspection:null})),null)
})

test('an AI profile and the website facts are both shown, and labelled as different things',()=>{
 const stored=buildStoredWebsiteFacts(lead(1))
 const member=memberDossierModel({id:'m',company_name:'Acme',industry:'Dentist',city:'Laval',archived:false,status:null,pipeline_stage:null,notes:null,created_at:null,last_activity_at:null,source:null,website:stored,
  contact:{name:null,email:'a@b.ca',email_source:null,email_confidence:'high',is_generic_email:false,phone:null,website:'https://g1.ca',source_url:null},
  intelligence:{state:'ready',label:'Profile ready',reason:null,researched_at:null,card:{summary:'AI wrote this.',services:[],audience:null,facts:{signals:[],pagesRead:[],sources:[]},limitations:[]},profile:{industry:null,business_category:null,primary_service:null,core_services:['Cleanings'],target_customer:'Families',keywords:[]}}})
 assert.equal(member.what.ai.text,'AI wrote this.');assert.deepEqual(member.what.ai.offers,['Cleanings'])
 assert.equal(member.what.site.text,'Family dental care 1.')
 assert.notEqual(member.what.ai.text,member.what.site.text)
 assert.equal(member.what.aiNote,null)
})

test('stored facts are untrusted when read: cleaned, capped, and only safe links survive',()=>{
 assert.equal(parseStoredWebsiteFacts(null),null);assert.equal(parseStoredWebsiteFacts('x'),null);assert.equal(parseStoredWebsiteFacts([]),null)
 assert.equal(parseStoredWebsiteFacts({version:2,origin:'free_trial',title:'x'}),null,'unknown version')
 assert.equal(parseStoredWebsiteFacts({version:1,origin:'ai',title:'x'}),null,'only free-trial facts are accepted')
 assert.equal(parseStoredWebsiteFacts({version:1,origin:'free_trial',title:'  ',headings:[1,null]}),null,'nothing to show')
 const parsed=parseStoredWebsiteFacts({version:1,origin:'free_trial',title:'T'.repeat(500),description:'D'.repeat(900),headings:Array.from({length:20},(_,i)=>`H${i}`),source_urls:['javascript:alert(1)','data:text/html,x','https://ok.ca/','https://ok.ca/',`https://x.ca/${'a'.repeat(600)}`],inspection:{state:'bogus',partial:true},captured_at:'nope'})
 assert.equal(parsed.title.length,200);assert.equal(parsed.description.length,400);assert.equal(parsed.headings.length,8)
 assert.deepEqual(parsed.source_urls,['https://ok.ca/']);assert.equal(parsed.inspection,null);assert.equal(parsed.captured_at,null)
})

// ---- the free allowance is never reset or stacked

test('a free account is held to its 25: the library already counts, so signing up adds nothing',async()=>{
 const fullLibrary=(n)=>Array.from({length:n},(_,i)=>({id:`own-${i}`,company_name:`Own ${i}`,email:`o${i}@own.ca`,phone:null,website:null,city:'Laval',website_facts:null}))
 for(const [existing,expectImported,expectSkipped] of [[0,25,0],[10,15,10],[24,1,24],[25,0,25],[40,0,25]]){
  reset({existingLeads:fullLibrary(existing)});state.leads=Array.from({length:25},(_,i)=>lead(i))
  const {body}=await run()
  assert.equal(body.imported,expectImported,`library ${existing}`);assert.equal(body.skipped_allowance,expectSkipped,`library ${existing}`)
  // discovery counts a free account's businesses with an email or phone: after signup it can never exceed the 25 it already had
  assert.ok(Math.max(existing,0)+body.imported<=Math.max(25,existing),'the library never grows past the free 25 through signup')
 }
})

test('paid and administrator accounts are not capped by the free allowance, and a free trial is still one per account',async()=>{
 for(const profile of [{plan:'starter',plan_status:'active'},{plan:'admin'}]){
  reset({profile,existingLeads:Array.from({length:40},(_,i)=>({id:`o${i}`,company_name:`O${i}`,email:`o${i}@x.ca`,phone:null,website:null,city:'X',website_facts:null}))});state.leads=Array.from({length:25},(_,i)=>lead(i))
  assert.equal((await run()).body.imported,25,JSON.stringify(profile))
 }
 reset({otherTrials:[{id:'earlier-trial'}]});state.leads=Array.from({length:25},(_,i)=>lead(i))
 const {body}=await run()
 assert.deepEqual([body.imported,body.skipped_allowance],[0,0])
 assert.equal(state.claimed,undefined,'a second trial is not imported on top of the first')
 assert.equal(state.owner_user_id,undefined,'and it is not linked either')
})

test('signing in again does not import twice: duplicates are skipped and counted, nothing is added',async()=>{
 reset();state.leads=Array.from({length:5},(_,i)=>lead(i))
 const first=(await run()).body;assert.equal(first.imported,5)
 const saved=state.claimed.map((row,i)=>({id:`s${i}`,company_name:row.company_name,email:row.email??null,phone:row.phone??null,website:row.website,city:row.city,website_facts:row.website_facts}))
 state.existingLeads=saved;state.claimed=undefined
 const again=(await run()).body
 assert.deepEqual([again.imported,again.skipped_duplicate,again.backfilled],[0,5,0])
 assert.equal(state.claimed,undefined);assert.deepEqual(state.updates,[])
})

test('businesses imported before the facts were kept get them on the next sign-in, and existing facts are never overwritten',async()=>{
 reset();state.leads=[lead(1),lead(2)]
 state.existingLeads=[{id:'a',company_name:'Guest Business 1',email:'info@g1.ca',phone:'+1 450 555 0100',website:'https://g1.ca',city:'Laval',website_facts:null},
  {id:'b',company_name:'Guest Business 2',email:'info@g2.ca',phone:'+1 450 555 0100',website:'https://g2.ca',city:'Laval',website_facts:{version:1,origin:'free_trial',title:'Already here',description:null,headings:[],source_urls:[]}}]
 const {body}=await run()
 assert.deepEqual([body.imported,body.skipped_duplicate,body.backfilled],[0,2,1])
 assert.equal(state.updates.length,1);assert.equal(state.updates[0].website_facts.description,'Family dental care 1.')
})

test('before the database has the facts column signup still works, and the facts follow once it exists',async()=>{
 reset({factsColumn:false});state.leads=Array.from({length:3},(_,i)=>lead(i))
 const {status,body}=await run()
 assert.equal(status,200);assert.equal(body.imported,3);assert.equal(state.claimed.every((row)=>!('website_facts' in row)),true)
 // the column arrives; the same visitor signs in again
 const saved=state.claimed.map((row,i)=>({id:`s${i}`,company_name:row.company_name,email:row.email??null,phone:row.phone??null,website:row.website,city:row.city,website_facts:null}))
 state.factsColumn=true;state.existingLeads=saved;state.claimed=undefined;state.updates=[]
 const later=(await run()).body
 assert.deepEqual([later.imported,later.backfilled],[0,3])
})

test('claim is for signed-in, same-origin visitors with a live trial',async()=>{
 reset({user:null});assert.equal((await run()).status,401)
 reset();const refused=await claim(req('/api/guest/claim',{},'https://evil.example'));assert.equal(refused.status,403)
 reset({expired:true});state.leads=[lead(1)];assert.equal((await run()).status,410)
 reset();assert.deepEqual((await run()).body,{success:true,imported:0,skipped_invalid:0,skipped_duplicate:0,skipped_allowance:0,backfilled:0},'an empty trial imports nothing')
})
