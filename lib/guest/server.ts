import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { GUEST_COOKIE, GUEST_MAX_AGE, readGuestId, signGuestId } from './security'

export function guestDb() {
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
 })
}
export async function guestSession(create = false) {
 const store = await cookies()
 const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
 if (!key) throw new Error('Guest trial is unavailable')
 let id = readGuestId(store.get(GUEST_COOKIE)?.value, key)
 if (!id && !create) {
  const auth = await createSupabaseServerClient()
  const {data:{user}} = await auth.auth.getUser()
  if (user) {
   const {data,error} = await guestDb().from('guest_trials').select('id').eq('owner_user_id',user.id)
    .gte('created_at',new Date(Date.now()-GUEST_MAX_AGE*1000).toISOString()).order('created_at',{ascending:false}).limit(1).maybeSingle()
   if(error) throw new Error('Saved trial unavailable')
   if(data) {
    id = data.id
    store.set(GUEST_COOKIE,signGuestId(id!,key),{httpOnly:true,secure:process.env.NODE_ENV === 'production',sameSite:'lax',path:'/',maxAge:GUEST_MAX_AGE})
   }
  }
 }
 if (!id && create) {
  id = crypto.randomUUID()
  const { error } = await guestDb().from('guest_trials').insert({id})
  if (error) throw new Error('Guest trial is unavailable')
  store.set(GUEST_COOKIE, signGuestId(id,key), { httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'lax', path:'/', maxAge:GUEST_MAX_AGE })
 }
 return id
}
export async function loadGuestSession(id: string) {
 const { data,error } = await guestDb().from('guest_trials').select('leads,used,attempts,email,marketing_opt_in,created_at,active_until').eq('id',id).single()
 if(error || !data || Date.parse(data.created_at) < Date.now()-GUEST_MAX_AGE*1000) throw new Error('This trial has expired. Please start again.')
 const { active_until, ...trial } = data
 // Whether a search is running now, so a phone that lost its connection can wait for the real outcome. The run id stays private.
 return { ...trial, searching: Boolean(active_until && Date.parse(active_until) > Date.now()) }
}
