'use client'

import { useEffect, useState } from 'react'

import { AuthShell } from '@/components/auth/AuthShell'
import { HandOverPanel } from '@/components/auth/HandOverPanel'
import { isSignedIn } from '@/lib/auth/continue-client'

// Where a customer who is already signed in lands instead of the login page: it hands over this browser's own guest businesses (as the
// login form does) and takes them to their workspace. Nobody signed in is sent to log in.
export default function ContinuePage() {
  const [state, setState] = useState<'checking' | 'signed-in'>('checking')
  useEffect(() => {
    void isSignedIn().then((signedIn) => (signedIn ? setState('signed-in') : window.location.replace('/login')))
  }, [])
  return state === 'signed-in' ? <HandOverPanel title="Welcome back" /> : (
    <AuthShell title="Welcome back">
      <p role="status" className="text-center text-sm text-slate-400">One moment…</p>
    </AuthShell>
  )
}
