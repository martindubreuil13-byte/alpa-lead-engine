// Phase 6: the one-question feedback. The real route against an offline stand-in for the database: no network, no email, no AI.
import assert from 'node:assert/strict'
import {register} from 'node:module'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import fs from 'node:fs'
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
const {GET,POST}=await import('../app/api/guest/feedback/route.ts')
const {state}=await import('./fixtures/guest/server.mjs')
const {parseFeedbackInput,buildFeedbackMetadata,readStoredFeedback,FEEDBACK_MAX_SENDS,FEEDBACK_MAX_COMMENT,FEEDBACK_YES_THANKS,FEEDBACK_QUESTION}=await import('../lib/guest/feedback.ts')

const USER={id:'f418184a-7d53-49de-a560-24c571aabc28'}
const req=(body,origin='https://alpa.example')=>new Request('https://alpa.example/api/guest/feedback',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)})
const lead=(i)=>({id:`g-${i}`,company_name:`Guest Business ${i}`,email:`i@g${i}.ca`,phone:null,website:null,city:'Laval',industry:'Dentist'})
function reset(over={}){
 Object.assign(state,{leads:Array.from({length:10},(_,i)=>lead(i)),used:10,attempts:1,created_at:new Date(Date.now()-5*3_600_000).toISOString(),feedbackRows:[],feedbackError:false,expired:false,user:null,...over})
}
const send=async(body,origin)=>{const r=await POST(req(body,origin));return {status:r.status,body:await r.json()}}

// ---- the question and what may be sent

test('the question, the three answers and the thank-you are exactly as agreed',()=>{
 assert.equal(FEEDBACK_QUESTION,'Did ALPA find what you were looking for?')
 assert.equal(FEEDBACK_YES_THANKS,'Glad ALPA helped. Good luck turning those businesses into customers.')
 for(const answer of ['yes','partly','not_really'])assert.equal(parseFeedbackInput({answer}).ok,true)
 for(const bad of [{answer:'maybe'},{answer:''},{},{answer:1},null,[],'yes',{answer:'yes',comment:5},{answer:'yes',comment:{}}])assert.equal(parseFeedbackInput(bad).ok,false,JSON.stringify(bad))
})

test('a comment is plain, short text: trimmed, control characters removed, capped, and nothing else is read from the request',()=>{
 const p=(body)=>parseFeedbackInput({answer:'partly',...body}).input
 assert.equal(p({comment:'  Too few emails.  '}).comment,'Too few emails.')
 assert.equal(p({comment:'a\u0000b\u0007c\u007f'}).comment,'abc')
 assert.equal(p({comment:'x'.repeat(2000)}).comment.length,FEEDBACK_MAX_COMMENT)
 assert.equal(p({comment:'   '}).comment,null);assert.equal(p({comment:null}).comment,null);assert.equal(p({}).comment,null)
 assert.equal(p({comment:'a\n\n\n\n\nb'}).comment,'a\n\nb')
 assert.equal(p({analyticsSessionId:'not a session!'}).analyticsSessionId,null)
 assert.equal(p({analyticsSessionId:'6a8c-4d2e-9f01-aaaa'}).analyticsSessionId,'6a8c-4d2e-9f01-aaaa')
 const input=p({email:'a@b.ca',name:'X',user_id:'u',trial_id:'t',comment:'ok'})
 assert.deepEqual(Object.keys(input).sort(),['analyticsSessionId','answer','comment','downloaded'],'no email, name, user or trial id is accepted from the browser')
})

// ---- storing it

test('anonymous visitor: one row for the trial, with the answer, the timestamp and the server\'s own facts about the trial; no email',async()=>{
 reset()
 const {status,body}=await send({answer:'partly',downloaded:true,analyticsSessionId:'6a8c-4d2e-9f01-aaaa'})
 assert.equal(status,200);assert.deepEqual(body.feedback,{answer:'partly',hasComment:false})
 assert.equal(state.feedbackRows.length,1)
 const row=state.feedbackRows[0]
 assert.equal(row.event,'trial_feedback');assert.equal(row.email,null);assert.equal(row.user_id,null);assert.equal(row.query,null);assert.equal(row.location,null)
 assert.equal(row.session_id,'6a8c-4d2e-9f01-aaaa','stored under the visitor\'s analytics session, so it reads next to the funnel events')
 assert.equal(row.leads_count,10)
 const m=row.metadata
 assert.equal(m.trial_id,'4f928ea6-1c42-4a98-ae76-999adc264612');assert.equal(m.answer,'partly');assert.equal(m.comment,null);assert.equal(m.has_comment,false)
 assert.deepEqual([m.saved_businesses,m.searches,m.businesses_used,m.signed_in,m.downloaded,m.trial_age_hours,m.sends],[10,1,10,false,true,5,1])
 assert.ok(Date.parse(m.first_sent_at)>0&&Date.parse(m.last_sent_at)>0,'timestamped')
 assert.deepEqual(Object.keys(m).filter(k=>/email|name|ip|agent|fingerprint/i.test(k)),[],'nothing personal is stored')
})

test('signed-in visitor: the same row, associated with the account',async()=>{
 reset({user:USER})
 await send({answer:'yes'})
 assert.equal(state.feedbackRows[0].user_id,USER.id);assert.equal(state.feedbackRows[0].metadata.signed_in,true)
 assert.equal(state.feedbackRows[0].session_id,'4f928ea6-1c42-4a98-ae76-999adc264612','without an analytics session it is stored under the trial')
})

test('a comment is added to the same row; repeats and refreshes never create a second one',async()=>{
 reset()
 await send({answer:'not_really'})
 const second=await send({answer:'not_really',comment:'Mostly restaurants, I wanted dentists.'})
 assert.equal(second.body.feedback.hasComment,true)
 await send({answer:'not_really'}) // a repeat with no comment must not erase the comment
 assert.equal(state.feedbackRows.length,1,'one row per trial')
 assert.equal(state.feedbackRows[0].metadata.comment,'Mostly restaurants, I wanted dentists.')
 assert.equal(state.feedbackRows[0].metadata.sends,3)
 const read=await (await GET()).json()
 assert.deepEqual(read.feedback,{answer:'not_really',hasComment:true},'a refresh remembers it')
})

test('changing the answer is allowed, and the latest wins',async()=>{
 reset()
 await send({answer:'yes'});await send({answer:'partly'})
 assert.equal(state.feedbackRows.length,1);assert.equal(state.feedbackRows[0].metadata.answer,'partly')
 assert.equal(state.feedbackRows[0].metadata.first_sent_at<=state.feedbackRows[0].metadata.last_sent_at,true)
})

test('abuse: a trial can send only a handful of times; the rest are refused without touching the row',async()=>{
 reset()
 for(let i=0;i<FEEDBACK_MAX_SENDS;i+=1)assert.equal((await send({answer:'partly',comment:`c${i}`})).status,200)
 const refused=await send({answer:'yes',comment:'spam'})
 assert.equal(refused.status,429)
 assert.equal(state.feedbackRows.length,1);assert.equal(state.feedbackRows[0].metadata.answer,'partly');assert.equal(state.feedbackRows[0].metadata.comment,`c${FEEDBACK_MAX_SENDS-1}`)
})

test('the trial decides who is answering: forged ids, accounts and emails in the request change nothing',async()=>{
 reset()
 await send({answer:'yes',trial_id:'00000000-0000-4000-8000-000000000000',user_id:USER.id,email:'x@y.ca',metadata:{answer:'not_really'}})
 const m=state.feedbackRows[0].metadata
 assert.equal(m.trial_id,'4f928ea6-1c42-4a98-ae76-999adc264612');assert.equal(state.feedbackRows[0].user_id,null);assert.equal(state.feedbackRows[0].email,null);assert.equal(m.answer,'yes')
})

// ---- missing, expired and refused

test('no trial, an expired trial, an empty trial, a foreign origin and bad input are each refused plainly',async()=>{
 reset({expired:true});assert.equal((await send({answer:'yes'})).status,410)
 reset({leads:[]});assert.equal((await send({answer:'yes'})).status,400,'nothing to give feedback on')
 reset();assert.equal((await send({answer:'yes'},'https://evil.example')).status,403)
 reset();assert.equal((await send({answer:'maybe'})).status,400);assert.equal((await send('not json')).status,400)
 assert.equal(state.feedbackRows.length,0,'none of these stored anything')
})

test('a storage failure is reported as a failure (so the page can say so) and never as success',async()=>{
 reset({feedbackError:true})
 const {status,body}=await send({answer:'yes'})
 assert.equal(status,503);assert.match(body.error,/could not be saved/)
 assert.deepEqual(await (await GET()).json(),{feedback:null},'reading degrades to "not answered yet"')
})

test('reading it back is safe: a malformed or foreign stored value is "not answered"',()=>{
 assert.equal(readStoredFeedback(null),null);assert.equal(readStoredFeedback({answer:'maybe'}),null);assert.equal(readStoredFeedback([]),null)
 assert.deepEqual(readStoredFeedback({answer:'yes',comment:'x'.repeat(900),sends:'3'}),{answer:'yes',comment:'x'.repeat(500),sends:3})
 const built=buildFeedbackMetadata({answer:'yes',sends:FEEDBACK_MAX_SENDS,trial_id:'t'},{answer:'yes',comment:null,analyticsSessionId:null,downloaded:false},{trialId:'t',savedBusinesses:1,searches:1,businessesUsed:1,trialCreatedAt:null,signedIn:false})
 assert.equal(built.ok,false)
})

// ---- the prompt itself: discreet, optional, and kept apart from selling and from downloading

const read=(file)=>fs.readFileSync(file,'utf8')
const prompt=read('components/guest/FeedbackPrompt.tsx').replace(/^\s*\/\/.*$/gm,'')

test('the prompt is one quiet inline question with three answers, a comment only for Partly and Not really, and no email',()=>{
 assert.match(prompt,/FEEDBACK_QUESTION/);assert.match(prompt,/FEEDBACK_LABELS\[answer\]/);assert.match(prompt,/aria-pressed=\{choice === answer\}/)
 assert.match(prompt,/answered === 'yes' \? <p role="status"[^>]*>\{FEEDBACK_YES_THANKS\}/)
 assert.match(prompt,/answered && answered !== 'yes'/);assert.match(prompt,/FEEDBACK_COMMENT_PROMPT/);assert.match(prompt,/maxLength=\{FEEDBACK_MAX_COMMENT\}/)
 assert.match(prompt,/Optional\. No email or account needed\./)
 assert.doesNotMatch(prompt,/type="email"|type="password"|role="dialog"|aria-modal|window\.open|alert\(|confirm\(|autoFocus/)
 assert.match(prompt,/min-h-\[44px\]/);assert.match(prompt,/sm:text-sm/,'16px field on a phone')
})

test('answering never sells, redirects or blocks: no plans link, no upgrade panel, no navigation, and the CSV link is independent',()=>{
 assert.doesNotMatch(prompt,/\/plans|UpgradePanel|first-month-offer|router|location\.|href=|50%|discount|stripe|checkout/i)
 const workspace=read('components/guest/GuestWorkspace.tsx')
 assert.match(workspace,/<FeedbackPrompt engaged=\{opened \|\| downloaded \|\| filtered\} downloaded=\{downloaded\} \/>/)
 assert.ok(workspace.indexOf('<FeedbackPrompt')>workspace.indexOf('</ul>'),'it comes after the businesses, never before or over them')
 assert.match(workspace,/href="\/api\/guest\/export" onClick=\{onDownload\}/,'the CSV link does not depend on the prompt')
 assert.doesNotMatch(prompt,/onDownload|api\/guest\/export/)
})

test('it appears only after the visitor has had a chance to explore, and never by itself on top of anything',()=>{
 assert.match(prompt,/const DWELL_MS = 15_000/);assert.match(prompt,/loaded && \(engaged \|\| dwelled \|\| Boolean\(saved\)\)/)
 assert.match(prompt,/if \(!visible\) return null/)
})

test('the route uses the existing analytics table, sends no email, and needs no migration',()=>{
 const route=read('app/api/guest/feedback/route.ts').replace(/^\s*\/\/.*$/gm,'')
 assert.match(route,/from\('activity_logs'\)/);assert.match(route,/email: null/)
 assert.doesNotMatch(route,/resend|nodemailer|send-email|results-email|stripe|checkout|openai|fetch\(/i)
 assert.match(route,/sameOrigin\(req\)/);assert.match(route,/guestSession\(\)/);assert.doesNotMatch(route,/guestSession\(true\)/,'feedback never creates a trial')
 assert.equal(fs.readdirSync('supabase/proposed').some(f=>/feedback/i.test(f)),false)
 assert.equal(fs.readdirSync('supabase/applied-records').some(f=>/feedback/i.test(f)),false)
})

test('the analysis is documented with read-only queries for the five questions',()=>{
 const doc=read('docs/feedback-analysis.md')
 for(const needle of ['trial_feedback','trial_feedback_prompt_shown','How many found ALPA useful','Problems mentioned repeatedly','downloading','upgrading','guest_trials','No new table and no migration','latest row per'])assert.match(doc,new RegExp(needle))
 assert.doesNotMatch(doc.replace(/```sql[\s\S]*?```/g,''),/\b(delete|drop|truncate)\b\s+(from|table)/i)
})
