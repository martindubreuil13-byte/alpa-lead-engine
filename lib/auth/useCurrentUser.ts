'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase/client'

let currentUser: User | null | undefined
let currentUserPromise: Promise<User | null> | null = null
const listeners = new Set<(user: User | null) => void>()

function notify(user: User | null) {
  currentUser = user
  for (const listener of listeners) {
    listener(user)
  }
}

function loadCurrentUser() {
  if (currentUser !== undefined) {
    return Promise.resolve(currentUser)
  }

  if (!currentUserPromise) {
    currentUserPromise = supabase.auth
      .getUser()
      .then(({ data }) => data.user ?? null)
      .then((user) => {
        notify(user)
        return user
      })
      .finally(() => {
        currentUserPromise = null
      })
  }

  return currentUserPromise
}

supabase.auth.onAuthStateChange((_event, session) => {
  notify(session?.user ?? null)
})

export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(currentUser ?? null)
  const [loading, setLoading] = useState(currentUser === undefined)

  useEffect(() => {
    let mounted = true

    const listener = (nextUser: User | null) => {
      if (mounted) {
        setUser(nextUser)
        setLoading(false)
      }
    }

    listeners.add(listener)

    loadCurrentUser().then((nextUser) => {
      if (mounted) {
        setUser(nextUser)
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      listeners.delete(listener)
    }
  }, [])

  return { user, loading }
}
