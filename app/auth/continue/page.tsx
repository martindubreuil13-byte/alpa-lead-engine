'use client'

import { useEffect, useRef } from 'react'

import { AuthShell } from '@/components/auth/AuthShell'
import { destinationForSignedInCustomer } from '@/lib/auth/continue-client'

// Where a customer who is already signed in lands instead of the login page: it takes them on to checkout (a plan waiting for them) or
// their workspace. Nobody signed in is sent to log in.
export default function ContinuePage() {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void destinationForSignedInCustomer().then((destination) => window.location.replace(destination ?? '/login'))
  }, [])
  return (
    <AuthShell title="Welcome back">
      <p role="status" className="text-center text-sm text-slate-400">One moment…</p>
    </AuthShell>
  )
}
