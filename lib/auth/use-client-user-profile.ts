'use client'

import { useEffect, useState } from 'react'

import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase/types'

export function useClientUserProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      setLoading(true)

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (cancelled) return

      if (error || !user?.id) {
        setProfile(null)
        setLoading(false)
        return
      }

      const { data: dbProfile } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return

      setProfile({
        id: user.id,
        email: user.email ?? '',
        role: dbProfile?.role ?? 'user',
        plan: dbProfile?.plan ?? 'free',
        created_at: dbProfile?.created_at ?? user.created_at ?? new Date().toISOString(),
      })
      setLoading(false)
    }

    void loadProfile()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void loadProfile()
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return { profile, loading }
}
