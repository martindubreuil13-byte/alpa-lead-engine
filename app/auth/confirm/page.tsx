'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { AuthShell } from '@/components/auth/AuthShell'
import { HandOverPanel } from '@/components/auth/HandOverPanel'
import { ResendConfirmationForm } from '@/components/auth/ResendConfirmationForm'
import { CONFIRM_PATH, CONFIRM_PROBLEMS, parseConfirmationLink } from '@/lib/auth/email-confirmation'
import { isSignedIn } from '@/lib/auth/continue-client'
import { takeInitialAuthUrl } from '@/lib/auth/initial-url'
import { establishSessionFromLink } from '@/lib/auth/password-reset'
import { supabase } from '@/lib/supabase'

type Phase = { name: 'checking' } | { name: 'continuing' } | { name: 'problem'; kind: keyof typeof CONFIRM_PROBLEMS }

export default function ConfirmEmailPage() {
  const [phase, setPhase] = useState<Phase>({ name: 'checking' })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // The address as it was when the page opened (the Supabase client removes the one-time code from it as it starts).
    const arrived = takeInitialAuthUrl()
    const link = parseConfirmationLink(arrived)

    void (async () => {
      const outcome = await establishSessionFromLink(supabase, link, { hasVerifier: arrived.hasVerifier })
      // Only now take the one-time values off the address bar: the Supabase client reads the address a moment after the page starts, and
      // cleaning it sooner would hide the code from it.
      if (link.kind !== 'none') window.history.replaceState(null, '', CONFIRM_PATH)
      if (outcome === 'ready') return setPhase({ name: 'continuing' })
      if (outcome === 'none') {
        // No link: someone signed in is taken on, anyone else goes to the login page.
        if (await isSignedIn()) return setPhase({ name: 'continuing' })
        return void window.location.replace('/login')
      }
      setPhase({ name: 'problem', kind: outcome })
    })()
  }, [])

  if (phase.name === 'checking') {
    return (
      <AuthShell title="Confirming your email">
        <p role="status" className="text-center text-sm text-slate-400">One moment…</p>
      </AuthShell>
    )
  }

  if (phase.name === 'continuing') return <HandOverPanel title="Email confirmed" subtitle="Taking you to your workspace…" />

  const problem = CONFIRM_PROBLEMS[phase.kind]
  return (
    <AuthShell title={problem.title}>
      <p role={phase.kind === 'other_browser' ? 'status' : 'alert'} className="mb-6 text-center text-sm leading-6 text-slate-300">{problem.text}</p>
      <Link href="/login" className="btn-primary-gold inline-flex min-h-12 w-full items-center justify-center">Log in</Link>
      {phase.kind === 'other_browser' ? null : (
        <div className="mt-6">
          <ResendConfirmationForm />
        </div>
      )}
    </AuthShell>
  )
}
