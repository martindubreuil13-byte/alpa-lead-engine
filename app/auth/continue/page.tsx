'use client'

import { useEffect, useRef, useState } from 'react'

import { GUEST_IMPORT_RETRY_MESSAGE } from '@/lib/guest/claim-client'
import { AuthShell } from '@/components/auth/AuthShell'
import { destinationForSignedInCustomer } from '@/lib/auth/continue-client'

// Where a customer who is already signed in lands instead of the login page: it takes them on to checkout (a plan waiting for them) or
// their workspace. Nobody signed in is sent to log in.
export default function ContinuePage() {
  const started = useRef(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void destinationForSignedInCustomer().then((destination) => window.location.replace(destination ?? '/login')).catch(() => setFailed(true))
  }, [])
  return (
    <AuthShell title="Welcome back">
      {failed ? (
        <div className="text-center">
          <p role="alert" className="mb-6 text-sm text-slate-300">{GUEST_IMPORT_RETRY_MESSAGE}</p>
          <button type="button" className="btn-primary-gold min-h-12 w-full" onClick={() => window.location.reload()}>Retry import</button>
        </div>
      ) : <p role="status" className="text-center text-sm text-slate-400">One moment…</p>}
    </AuthShell>
  )
}
