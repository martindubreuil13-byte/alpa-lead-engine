export const state = {leads:[],used:0,email:null,marketing_opt_in:false,searchCalls:0,existingLeads:[],profile:null,otherTrials:[],updates:[],factsColumn:true,feedbackRows:[],feedbackError:false}
export async function guestSession() {return '4f928ea6-1c42-4a98-ae76-999adc264612'}
export async function loadGuestSession() {if(state.expired)throw new Error('expired');return state}
export function guestDb() {return {
 rpc:async(name,args)=>{
  if(name==='reserve_guest_trial') {const n=Math.min(args.p_count,25-state.used);state.used+=n;state.reserved=n;return {data:n}}
  if(name==='finish_guest_trial') {state.used-=args.p_reserved-args.p_leads.length;state.leads.push(...args.p_leads);return {data:true}}
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
    state.claimed=rows;return {data:rows.map((_,i)=>({id:`saved-${i}`})),error:null}
   }}),
   update:values=>{const q={eq:()=>q,is:()=>q,select:async()=>{state.updates.push(values);return {data:[{id:'x'}],error:null}}};return q},
  }
 },
}}

export async function cookies(){return {getAll:()=>[],set:()=>{}}}
export function after(){/* no background work in offline fixture */}
export const NextResponse={json:(data,init)=>new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...init?.headers}})}
