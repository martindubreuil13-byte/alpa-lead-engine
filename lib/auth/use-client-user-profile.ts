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

      const [{ data: dbProfile }, subscriptionResponse] = await Promise.all([
        supabase
          .from('profiles')
          .select('created_at')
          .eq('id', user.id)
          .maybeSingle(),
        fetch('/api/auth/subscription', { cache: 'no-store' }),
      ])

      if (cancelled) return

      const subscriptionPayload = subscriptionResponse.ok
        ? await subscriptionResponse.json().catch(() => null)
        : null
      const subscription = subscriptionPayload?.subscription ?? null
      const plan = subscription?.plan || 'free'

      setProfile({
        id: user.id,
        email: user.email ?? '',
        role: plan === 'admin' ? 'admin' : 'user',
        plan,
        stripe_customer_id: subscription?.stripe_customer_id ?? null,
        stripe_subscription_id: subscription?.stripe_subscription_id ?? null,
        subscription_status: subscription?.plan_status ?? null,
        plan_status: subscription?.plan_status ?? null,
        cancel_at_period_end: subscription?.cancel_at_period_end ?? false,
        current_period_end: subscription?.current_period_end ?? null,
        subscription_tier: subscription?.subscription_tier ?? null,
        subscription_active: subscription?.subscription_active ?? false,
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
