'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { AuthShell, linkButtonClass } from '@/components/auth/AuthShell'
import { destinationForSignedInCustomer, handOverGuestTrial } from '@/lib/auth/continue-client'

/**
 * For a customer who is signed in and being taken on: brings this browser's own guest businesses into the account (the same request the
 * login form makes), then goes to their workspace. If that fails the businesses are still waiting, so it says so and offers a retry
 * instead of moving on silently.
 */
export function HandOverPanel({ title, subtitle }: { title: string; subtitle?: string }) {
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  const go = useCallback(async () => {
    window.location.replace(await destinationForSignedInCustomer())
  }, [])

  const run = useCallback(async () => {
    setFailed(false)
    const status = await handOverGuestTrial()
    if (status === 'failed') return void setFailed(true)
    await go()
  }, [go])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void run()
  }, [run])

  if (!failed) {
    return (
      <AuthShell title={title} subtitle={subtitle}>
        <p role="status" className="text-center text-sm text-slate-400">One moment…</p>
      </AuthShell>
    )
  }
  return (
    <AuthShell title="Almost there">
      <p role="alert" className="mb-6 text-center text-sm leading-6 text-slate-300">
        We could not bring your free businesses into your account just now. They are still saved in this browser, and we will try again the next time you sign in.
      </p>
      <button type="button" onClick={() => void run()} className="btn-primary-gold min-h-12 w-full">Try again</button>
      <div className="mt-2 text-center">
        <button type="button" onClick={() => void go()} className={linkButtonClass}>Continue to ALPA</button>
      </div>
    </AuthShell>
  )
}
