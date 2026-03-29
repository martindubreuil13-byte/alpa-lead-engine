import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { UserProfile } from '@/lib/supabase/types'

const DEV_FALLBACK_USER: UserProfile = {
  id: 'dev-user',
  email: 'dev@local',
  role: 'admin',
  plan: 'starter',
  created_at: new Date(0).toISOString(),
}

export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError) {
      console.error('getUserProfile auth error:', authError.message)
      return null
    }

    if (!user?.id) {
      console.log('USER PROFILE:', DEV_FALLBACK_USER)
      return DEV_FALLBACK_USER
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, email, role, plan, created_at')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      console.error('getUserProfile fetch error:', error.message)
      return null
    }

    if (!data) {
      return null
    }

    const profile = data as unknown as UserProfile

    console.log('USER PROFILE:', profile)
    return profile
  } catch (error) {
    console.error('getUserProfile unexpected error:', error)
    return null
  }
}
