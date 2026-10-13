export const state = {leads:[],used:0,email:null,marketing_opt_in:false,searchCalls:0}
export async function guestSession() {return '4f928ea6-1c42-4a98-ae76-999adc264612'}
export async function loadGuestSession() {return state}
export function guestDb() {return {
 rpc:async(name,args)=>{
  if(name==='reserve_guest_trial') {const n=Math.min(args.p_count,25-state.used);state.used+=n;state.reserved=n;return {data:n}}
  if(name==='finish_guest_trial') {state.used-=args.p_reserved-args.p_leads.length;state.leads.push(...args.p_leads);return {data:true}}
  throw new Error(`Unexpected RPC ${name}`)
 },
 from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{created_at:new Date().toISOString(),attempts:1,used:state.used,active_until:null},error:null})})}),update:values=>({eq:()=>{Object.assign(state,values);return {then:resolve=>resolve({error:null}),or:()=>({select:async()=>({data:[{id:'fixture'}],error:null})})}}})}),
}}
export function createServerClient(){return {
 auth:{getUser:async()=>({data:{user:state.user || null}})},
 from:()=>({select:()=>({eq:async()=>({data:[],error:null})}),insert:rows=>({select:async()=>{state.claimed=rows;return {data:rows.map((_,i)=>({id:`saved-${i}`})),error:null}}})}),
}}

export async function cookies(){return {getAll:()=>[],set:()=>{}}}
export function after(){/* no background work in offline fixture */}
export const NextResponse={json:(data,init)=>new Response(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...init?.headers}})}
