'use client'

import { useEffect, useState } from 'react'

import { inputClass } from '@/components/auth/AuthShell'
import { confirmRedirectUrl, requestConfirmationResend, RESEND_MESSAGES } from '@/lib/auth/email-confirmation'
import { MESSAGES, RESEND_COOLDOWN_SECONDS } from '@/lib/auth/password-reset'
import { supabase } from '@/lib/supabase'

type View = { state: 'idle' } | { state: 'sending' } | { state: 'sent' } | { state: 'error'; text: string }

/** Asks for a new confirmation link. Same neutral answer whether or not the address is waiting to be confirmed. */
export function ResendConfirmationForm() {
  const [email, setEmail] = useState('')
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
    const redirectTo = confirmRedirectUrl({ origin: window.location.origin, appUrl: process.env.NEXT_PUBLIC_APP_URL, production: process.env.NODE_ENV === 'production' })
    const outcome = await requestConfirmationResend(supabase, email, redirectTo)
    if (outcome.kind === 'sent') { setView({ state: 'sent' }); setCooldown(RESEND_COOLDOWN_SECONDS) }
    else if (outcome.kind === 'rate_limited') setView({ state: 'error', text: MESSAGES.rateLimited })
    else if (outcome.kind === 'invalid_email') setView({ state: 'error', text: MESSAGES.invalidEmail })
    else setView({ state: 'error', text: MESSAGES.unavailable })
  }

  const busy = view.state === 'sending'
  return (
    <form noValidate className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <div>
        <label htmlFor="resend-email" className="sr-only">Email</label>
        <input id="resend-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send"
          disabled={busy} className={inputClass} placeholder="Email address" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      {view.state === 'error' ? <div role="alert" className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">{view.text}</div> : null}
      {view.state === 'sent' ? <div role="status" className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm leading-6 text-cyan-50">{RESEND_MESSAGES.sent}</div> : null}
      <button type="submit" disabled={busy || cooldown > 0} className="btn-primary-gold min-h-12 w-full">
        {busy ? 'Sending…' : cooldown > 0 ? `Send again in ${cooldown}s` : 'Send a new confirmation link'}
      </button>
    </form>
  )
}
