'use client'

import { useEffect, useState } from 'react'

import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase/types'

export function useClientUserProfile() {
  const { user, loading: userLoading } = useCurrentUser()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      if (userLoading) return

      setLoading(true)

      if (!user?.id) {
        setProfile(null)
        setLoading(false)
        return
      }

      const { data: dbProfile } = await supabase
        .from('profiles')
        .select('plan, subscription_status, current_period_end, created_at')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      const plan = dbProfile?.plan || 'free'

      setProfile({
        id: user.id,
        email: user.email ?? '',
        role: plan === 'admin' ? 'admin' : 'user',
        plan,
        subscription_status: dbProfile?.subscription_status ?? null,
        current_period_end: dbProfile?.current_period_end ?? null,
        created_at: dbProfile?.created_at ?? user.created_at ?? new Date().toISOString(),
      })
      setLoading(false)
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [user, userLoading])

  return { profile, loading }
}
