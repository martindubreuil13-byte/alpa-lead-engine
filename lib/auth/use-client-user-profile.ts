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
        .select(
          'plan, stripe_customer_id, stripe_subscription_id, subscription_status, plan_status, cancel_at_period_end, current_period_end, subscription_tier, created_at'
        )
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      const plan = dbProfile?.plan || 'free'

      setProfile({
        id: user.id,
        email: user.email ?? '',
        role: plan === 'admin' ? 'admin' : 'user',
        plan,
        stripe_customer_id: dbProfile?.stripe_customer_id ?? null,
        stripe_subscription_id: dbProfile?.stripe_subscription_id ?? null,
        subscription_status: dbProfile?.subscription_status ?? null,
        plan_status: dbProfile?.plan_status ?? null,
        cancel_at_period_end: dbProfile?.cancel_at_period_end ?? false,
        current_period_end: dbProfile?.current_period_end ?? null,
        subscription_tier: dbProfile?.subscription_tier ?? null,
        subscription_active: plan === 'admin' || Boolean(dbProfile?.subscription_tier && dbProfile.subscription_tier !== 'free'),
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
