import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserProfile } from '@/lib/supabase/types'

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (!user || error) {
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, subscription_status, current_period_end, created_at')
    .eq('id', user.id)
    .maybeSingle()

  const plan = profile?.plan || 'free'

  return {
    id: user.id,
    email: user.email ?? '',
    role: plan === 'admin' ? 'admin' : 'user',
    plan,
    subscription_status: profile?.subscription_status ?? null,
    current_period_end: profile?.current_period_end ?? null,
    created_at: profile?.created_at ?? user.created_at ?? new Date().toISOString(),
  }
}
