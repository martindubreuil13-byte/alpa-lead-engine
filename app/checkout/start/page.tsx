'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import {
  clearPendingCheckout,
  loginHref,
  parseCheckoutPlan,
  parseCheckoutSource,
  readPendingCheckout,
} from '@/lib/checkout/pending-plan'

// The step between "I have an account" and Stripe: it starts the checkout for the plan the visitor chose before signing up. It does
// nothing by itself except ask the server (which verifies the account) for a checkout address, once, and go there.
function Continue() {
  const params = useSearchParams()
  const { user, loading } = useCurrentUser()
  const startedRef = useRef(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (loading || startedRef.current) return
    const stored = (() => { try { return readPendingCheckout(window.localStorage) } catch { return null } })()
    const plan = parseCheckoutPlan(params.get('plan')) ?? stored?.plan ?? null
    const source = parseCheckoutSource(params.get('source') ?? stored?.source)
    if (!plan) {
      setMessage('Choose a plan to continue.')
      return
    }
    if (!user?.id) {
      window.location.href = loginHref(plan, source)
      return
    }
    startedRef.current = true
    void (async () => {
      try {
        const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, plan }) })
        const data = await res.json().catch(() => null)
        if (res.status === 401) return void (window.location.href = loginHref(plan, source))
        if (res.status === 409 && data?.code === 'already_subscribed') return void (window.location.href = '/dashboard/billing')
        if (!res.ok || !data?.url) throw new Error(data?.error || 'Unable to start checkout')
        try { clearPendingCheckout(window.localStorage) } catch { /* nothing to clear */ }
        window.location.href = data.url
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to start checkout')
      }
    })()
  }, [loading, user, params])

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center text-white">
      <h1 className="text-2xl font-semibold">{message ? 'We could not start checkout' : 'Taking you to checkout…'}</h1>
      {message ? (
        <>
          <p role="alert" className="mt-3 text-sm text-white/75">{message}</p>
          <Link href="/plans" className="mt-6 inline-flex min-h-[44px] items-center text-[#d8c28a] underline underline-offset-4">Back to plans</Link>
        </>
      ) : (
        <p role="status" className="mt-3 text-sm text-white/70">Your account is ready. Continuing with the plan you chose.</p>
      )}
    </main>
  )
}

export default function CheckoutStartPage() {
  return (
    <Suspense fallback={null}>
      <Continue />
    </Suspense>
  )
}
