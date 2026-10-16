'use client'

import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AuthShell, inputClass, linkButtonClass } from '@/components/auth/AuthShell'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import {
  MIN_PASSWORD_LENGTH,
  UPDATE_MESSAGES,
  cleanedPath,
  establishRecoverySession,
  parseRecoveryLink,
  setNewPassword,
  validateNewPassword,
  type RecoveryOutcome,
} from '@/lib/auth/password-reset'
import { takeInitialAuthUrl } from '@/lib/auth/initial-url'
import { supabase } from '@/lib/supabase'

type Phase = 'checking' | 'form' | 'saving' | 'done' | Exclude<RecoveryOutcome, 'ready'>

const PROBLEM: Record<'expired' | 'invalid' | 'other_browser', { title: string; text: string }> = {
  expired: { title: 'This link has expired', text: 'Reset links work once and stop working after an hour. Request a new one below.' },
  invalid: { title: 'This link is not valid', text: 'The link may be incomplete or already used. Request a new one below.' },
  other_browser: {
    title: 'Open the link where you asked for it',
    text: 'For your security the link only works in the browser you requested it from. Open it there, or request a new link below from this browser.',
  },
}

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Read the link once, then take the one-time values off the address bar.
    // The address as it was when the page opened (the Supabase client removes the one-time code from it as it starts).
    const arrived = takeInitialAuthUrl()
    const link = parseRecoveryLink(arrived)
    void establishRecoverySession(supabase, link, { hasVerifier: arrived.hasVerifier }).then((outcome) => {
      // Only now take the one-time values off the address bar: the Supabase client reads the address a moment after the page starts, and
      // cleaning it sooner would hide the code from it.
      if (link.kind !== 'none') window.history.replaceState(null, '', cleanedPath())
      setPhase(outcome === 'ready' ? 'form' : outcome)
    })
  }, [])

  async function submit() {
    if (phase !== 'form') return
    const problem = validateNewPassword(password, confirm)
    if (problem) return void setError(problem)
    setError('')
    setPhase('saving')
    const outcome = await setNewPassword(supabase, password)
    if (outcome === 'updated') {
      setPassword('')
      setConfirm('')
      return void setPhase('done')
    }
    if (outcome === 'expired') return void setPhase('expired')
    setError(UPDATE_MESSAGES[outcome])
    setPhase('form')
  }

  if (phase === 'checking') {
    return (
      <AuthShell title="Checking your link">
        <p role="status" className="text-center text-sm text-slate-400">One moment…</p>
      </AuthShell>
    )
  }

  if (phase === 'done') {
    return (
      <AuthShell title="Password updated" subtitle="You are signed in. Other devices have been signed out.">
        <Link href="/dashboard" className="btn-primary-gold inline-flex min-h-12 w-full items-center justify-center">Continue</Link>
      </AuthShell>
    )
  }

  if (phase === 'form' || phase === 'saving') {
    const saving = phase === 'saving'
    return (
      <AuthShell title="Choose a new password" subtitle={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="relative">
            <label htmlFor="new-password" className="sr-only">New password</label>
            <input
              id="new-password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              disabled={saving}
              className={`${inputClass} pr-14`}
              placeholder="New password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow((value) => !value)}
              aria-label={show ? 'Hide password' : 'Show password'}
              aria-pressed={show}
              className="absolute right-1 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-xl text-slate-300 transition hover:text-white"
            >
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <div>
            <label htmlFor="confirm-password" className="sr-only">Confirm new password</label>
            <input
              id="confirm-password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              disabled={saving}
              className={inputClass}
              placeholder="Confirm new password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          {error ? <div role="alert" className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">{error}</div> : null}
          <button type="submit" disabled={saving} className="btn-primary-gold min-h-12 w-full">{saving ? 'Saving…' : 'Update password'}</button>
        </form>
      </AuthShell>
    )
  }

  // No link, or a link that cannot be used: say why, and let the visitor ask for a new one.
  const problem = phase === 'none' ? null : PROBLEM[phase]
  return (
    <AuthShell title={problem ? problem.title : 'Reset your password'}>
      {problem ? <p role="alert" className="mb-6 text-center text-sm leading-6 text-slate-300">{problem.text}</p> : null}
      <ForgotPasswordForm />
      <div className="mt-2 text-center">
        <Link href="/login" className={linkButtonClass}>Back to log in</Link>
      </div>
    </AuthShell>
  )
}
