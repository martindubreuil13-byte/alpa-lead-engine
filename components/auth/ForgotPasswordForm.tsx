'use client'

import { useEffect, useState } from 'react'

import { inputClass, linkButtonClass } from '@/components/auth/AuthShell'
import {
  MESSAGES,
  RESEND_COOLDOWN_SECONDS,
  requestPasswordReset,
  resetRedirectUrl,
  type ResetRequestOutcome,
} from '@/lib/auth/password-reset'
import { supabase } from '@/lib/supabase'

type View = { state: 'idle' } | { state: 'sending' } | { state: 'sent' } | { state: 'error'; text: string }

/**
 * Asks for a password-reset link. The answer is the same whether or not the address has an account; the only explicit failures are ones
 * that say nothing about any account (a bad address, no connection, the mail system being at its limit).
 */
export function ForgotPasswordForm({ initialEmail = '', onBack }: { initialEmail?: string; onBack?: () => void }) {
  const [email, setEmail] = useState(initialEmail)
  const [view, setView] = useState<View>({ state: 'idle' })
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function submit() {
    if (view.state === 'sending' || cooldown > 0) return
    setView({ state: 'sending' })
    const redirectTo = resetRedirectUrl({ origin: window.location.origin, appUrl: process.env.NEXT_PUBLIC_APP_URL, production: process.env.NODE_ENV === 'production' })
    const outcome: ResetRequestOutcome = await requestPasswordReset(supabase, email, redirectTo)
    if (outcome.kind === 'sent') {
      setView({ state: 'sent' })
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } else if (outcome.kind === 'rate_limited') setView({ state: 'error', text: MESSAGES.rateLimited })
    else if (outcome.kind === 'invalid_email') setView({ state: 'error', text: MESSAGES.invalidEmail })
    else setView({ state: 'error', text: MESSAGES.unavailable })
  }

  const busy = view.state === 'sending'
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-center text-sm leading-6 text-slate-400">Enter the email you signed up with and we will send you a link to choose a new password.</p>
      <div>
        <label htmlFor="reset-email" className="sr-only">Email</label>
        <input
          id="reset-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          disabled={busy}
          className={inputClass}
          placeholder="Email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      {view.state === 'error' ? (
        <div role="alert" className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">{view.text}</div>
      ) : null}
      {view.state === 'sent' ? (
        <div role="status" className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm leading-6 text-cyan-50">{MESSAGES.sent}</div>
      ) : null}

      <button type="submit" disabled={busy || cooldown > 0} className="btn-primary-gold min-h-12 w-full">
        {busy ? 'Sending…' : cooldown > 0 ? `Send again in ${cooldown}s` : view.state === 'sent' ? 'Send the link again' : 'Send reset link'}
      </button>
      {onBack ? (
        <div className="text-center">
          <button type="button" onClick={onBack} className={linkButtonClass}>Back to log in</button>
        </div>
      ) : null}
    </form>
  )
}
