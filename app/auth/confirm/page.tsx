'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { AuthShell, linkButtonClass } from '@/components/auth/AuthShell'
import { ResendConfirmationForm } from '@/components/auth/ResendConfirmationForm'
import { CONFIRM_PATH, CONFIRM_PROBLEMS, parseConfirmationLink } from '@/lib/auth/email-confirmation'
import { destinationForSignedInCustomer } from '@/lib/auth/continue-client'
import { establishSessionFromLink } from '@/lib/auth/password-reset'
import { supabase } from '@/lib/supabase'

type Phase = { name: 'checking' } | { name: 'continuing'; checkout: boolean } | { name: 'problem'; kind: keyof typeof CONFIRM_PROBLEMS }

export default function ConfirmEmailPage() {
  const [phase, setPhase] = useState<Phase>({ name: 'checking' })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Read the link once, then take its one-time values off the address bar.
    const link = parseConfirmationLink({ search: window.location.search, hash: window.location.hash })
    if (link.kind !== 'none') window.history.replaceState(null, '', CONFIRM_PATH)

    void (async () => {
      const outcome = await establishSessionFromLink(supabase, link)
      if (outcome === 'ready' || outcome === 'none') {
        const destination = await destinationForSignedInCustomer()
        if (destination) {
          setPhase({ name: 'continuing', checkout: destination.startsWith('/checkout/') })
          return void window.location.replace(destination)
        }
        // Nobody is signed in and there is no link to use: the way in is the login page.
        if (outcome === 'none') return void window.location.replace('/login')
        return setPhase({ name: 'problem', kind: 'invalid' })
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

  if (phase.name === 'continuing') {
    return (
      <AuthShell title="Email confirmed" subtitle={phase.checkout ? 'Taking you to checkout with the plan you chose…' : 'Taking you to your workspace…'}>
        <p role="status" className="text-center text-sm text-slate-400">One moment…</p>
      </AuthShell>
    )
  }

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
      <div className="mt-2 text-center">
        <Link href="/plans" className={linkButtonClass}>Back to plans</Link>
      </div>
    </AuthShell>
  )
}
