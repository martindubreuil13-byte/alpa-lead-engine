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
    .select('plan, created_at')
    .eq('id', user.id)
    .maybeSingle()

  return {
    id: user.id,
    email: user.email ?? '',
    role: profile?.plan === 'admin' ? 'admin' : 'user',
    plan: profile?.plan ?? 'free',
    created_at: profile?.created_at ?? user.created_at ?? new Date().toISOString(),
  }
}
