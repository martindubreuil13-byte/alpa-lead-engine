export const state = {leads:[],used:0,email:null,marketing_opt_in:false,searchCalls:0,existingLeads:[],profile:null,otherTrials:[],updates:[],factsColumn:true,feedbackRows:[],feedbackError:false,noCookie:false,profileAttempts:0,dailyUsed:0,profileCalls:[],lightProfileColumn:true,unknownTrial:false}
export async function guestSession() {return state.noCookie?null:'4f928ea6-1c42-4a98-ae76-999adc264612'}
export async function loadGuestSession() {if(state.expired)throw new Error('expired');return state}
export function guestDb() {return {
 rpc:async(name,args)=>{
  if(name==='claim_guest_businesses') {
   if(state.claimError)return {data:null,error:{message:'unavailable'}}
   if(state.owner_user_id&&state.owner_user_id!==args.p_user_id)return {data:null,error:{message:'wrong owner'}}
   const answer={success:true,imported:0,skipped_invalid:0,skipped_duplicate:0,skipped_allowance:0,backfilled:0}
   if(state.otherTrials.length)return {data:answer,error:null}
   const key=r=>['company_name','email','phone','website','city'].map(k=>String(r[k]??'').trim().toLowerCase()).join('::')
   const existing=new Map(state.existingLeads.map(r=>[key(r),r]))
   let used=state.lifetimeUsed??state.existingLeads.filter(r=>r.email||r.phone).length
   const paid=state.profile?.plan==='admin'||(['starter','starter_100','pro','prospector'].includes(state.profile?.plan)&&state.profile?.plan_status==='active')
   const added=[]
   for(const row of args.p_leads){
    if(!row.company_name||(!row.email&&!row.phone)){answer.skipped_invalid++;continue}
    const previous=existing.get(key(row))
    if(previous){answer.skipped_duplicate++;if(state.factsColumn&&row.website_facts&&!previous.website_facts){state.updates.push({website_facts:row.website_facts});answer.backfilled++}continue}
    if(!paid&&used>=25){answer.skipped_allowance++;continue}
    const copy={...row};if(!state.factsColumn)delete copy.website_facts;if(!state.lightProfileColumn)delete copy.light_profile
    added.push(copy);existing.set(key(row),copy);used++;answer.imported++
   }
   if(added.length)state.claimed=added
   state.owner_user_id=args.p_user_id
   return {data:answer,error:null}
  }
  if(name==='reserve_guest_trial') {const n=Math.min(args.p_count,25-state.used);state.used+=n;state.reserved=n;return {data:n}}
  if(name==='finish_guest_trial') {state.used-=args.p_reserved-args.p_leads.length;state.leads.push(...args.p_leads);return {data:true}}
  // The Phase 7 profile functions, with the same rules as supabase/proposed/20261018_guest_light_profiles.sql.
  if(name==='begin_guest_profile') {
   state.profileCalls.push(name)
   const lead=state.leads.find(l=>l.id===args.p_lead)
   if(!lead) return {data:'not_found'}
   if(lead.light_profile&&typeof lead.light_profile==='object') return {data:'cached'}
   if(lead.profile_claim&&Date.parse(lead.profile_claim.until)>Date.now()) return {data:'busy'}
   const made=state.leads.filter(l=>l.light_profile&&typeof l.light_profile==='object').length
   if(made>=args.p_max||state.profileAttempts>=args.p_max_attempts) return {data:'limit'}
   if(state.dailyUsed>=args.p_daily_max) return {data:'budget'}
   state.dailyUsed++;state.profileAttempts++
   lead.profile_claim={run:args.p_run,until:new Date(Date.now()+45000).toISOString()}
   return {data:'claimed'}
  }
  if(name==='finish_guest_profile') {
   const lead=state.leads.find(l=>l.id===args.p_lead)
   if(!lead||lead.profile_claim?.run!==args.p_run||JSON.stringify(args.p_profile).length>4000) return {data:false}
   delete lead.profile_claim;lead.light_profile=args.p_profile;return {data:true}
  }
  if(name==='release_guest_profile') {
   const lead=state.leads.find(l=>l.id===args.p_lead)
   if(!lead||lead.profile_claim?.run!==args.p_run) return {data:false}
   delete lead.profile_claim;return {data:true}
  }
  throw new Error(`Unexpected RPC ${name}`)
 },
 from:(table)=>table==='activity_logs'?activityLogs():({
  select:()=>({eq:()=>({maybeSingle:async()=>({data:{created_at:new Date().toISOString(),attempts:1,used:state.used,active_until:null},error:null}),neq:()=>({limit:async()=>({data:state.otherTrials,error:null})})})}),
  update:values=>({eq:()=>{Object.assign(state,values);return {then:resolve=>resolve({error:null}),or:()=>({select:async()=>({data:[{id:'fixture'}],error:null})})}}}),
 }),
}}
// The analytics table as the feedback route uses it: select by event and trial id, insert, and update by id.
const activityLogs=()=>{
 const filters=[];let patch=null
 const matches=(row)=>filters.every(([column,value])=>column==='metadata->>trial_id'?row.metadata?.trial_id===value:row[column]===value)
 const q={
  select:()=>q,order:()=>q,limit:()=>q,
  eq:(column,value)=>{filters.push([column,value]);return q},
  insert:async(row)=>{if(state.feedbackError)return {data:null,error:{message:'down'}};state.feedbackRows.push({id:`row-${state.feedbackRows.length+1}`,created_at:new Date().toISOString(),...row});return {data:null,error:null}},
  update:(values)=>{patch=values;return q},
  then:(resolve,reject)=>{
   if(state.feedbackError)return Promise.resolve({data:null,error:{message:'down'}}).then(resolve,reject)
   const rows=state.feedbackRows.filter(matches)
   if(patch){rows.forEach(row=>Object.assign(row,patch));return Promise.resolve({data:null,error:null}).then(resolve,reject)}
   return Promise.resolve({data:rows,error:null}).then(resolve,reject)
  },
 }
 return q
}
const missingColumn={code:'42703',message:'column leads.website_facts does not exist'}
const chain=(rows,error=null)=>{const p=Promise.resolve({data:rows,error});return p}
export function createServerClient(){return {
 auth:{getUser:async()=>({data:{user:state.user || null}})},
 from:(table)=>{
  if(table==='profiles')return {select:()=>({eq:()=>({maybeSingle:async()=>({data:state.profile,error:null})})})}
  return {
   select:(columns='')=>({eq:()=>chain(columns.includes('website_facts')&&!state.factsColumn?null:state.existingLeads,columns.includes('website_facts')&&!state.factsColumn?missingColumn:null)}),
   insert:rows=>({select:async()=>{
    if(!state.factsColumn&&rows.some(r=>'website_facts' in r))return {data:null,error:missingColumn}
    if(!state.lightProfileColumn&&rows.some(r=>'light_profile' in r))return {data:null,error:{code:'42703',message:'column leads.light_profile does not exist'}}
    state.claimed=rows;return {data:rows.map((_,i)=>({id:`saved-${i}`})),error:null}
   }}),
   update:values=>{const q={eq:()=>q,is:()=>q,select:async()=>{state.updates.push(values);return {data:[{id:'x'}],error:null}}};return q},
  }
 },
}}

export async function cookies(){return {getAll:()=>[],set:()=>{}}}
export function after(){/* no background work in offline fixture */}
export const NextResponse={json:(data,init)=>new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...init?.headers}})}
