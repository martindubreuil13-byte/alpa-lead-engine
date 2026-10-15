'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { AlpaLogo } from '@/components/brand/AlpaLogo'
import { trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { trackEvent } from '@/lib/track'
import { clearGuestTrialMode } from '@/lib/session/guest-trial-mode'
import { loginForPaymentHref } from '@/lib/checkout/pending-plan'

export default function PostCheckoutAccountForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: userLoading } = useCurrentUser()
  const initializedRef = useRef(false)
  const checkoutTrackedRef = useRef(false)
  const sessionId = searchParams.get('session_id') || ''
  const [verifying, setVerifying] = useState(true)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  function markCheckoutTracked(currentSessionId: string) {
    if (typeof window === 'undefined' || !currentSessionId) return
    window.sessionStorage.setItem(`alpa_checkout_completed_${currentSessionId}`, '1')
  }

  function hasTrackedCheckout(currentSessionId: string) {
    if (typeof window === 'undefined' || !currentSessionId) return false
    return window.sessionStorage.getItem(`alpa_checkout_completed_${currentSessionId}`) === '1'
  }

  useEffect(() => {
    if (userLoading) return
    if (initializedRef.current) return
    initializedRef.current = true
    void initialize()
  }, [user, userLoading])

  async function initialize() {
    setVerifying(true)
    setErrorMessage('')

    try {
      if (!sessionId) {
        throw new Error('Missing checkout session id')
      }

      // Checkout is only ever started by a signed-in customer, so the customer must be signed in to finish it. The server
      // confirms the session belongs to them; nothing about it is shown to anyone else.
      if (!user?.id) {
        setNeedsLogin(true)
        return
      }

      const res = await fetch(`/api/checkout/session?session_id=${encodeURIComponent(sessionId)}`)
      const data = await res.json().catch(() => null)

      if (res.status === 401) {
        setNeedsLogin(true)
        return
      }

      if (!res.ok || !data?.verified) {
        throw new Error(data?.error || 'We could not verify your checkout')
      }

      if (!checkoutTrackedRef.current && !hasTrackedCheckout(sessionId)) {
        checkoutTrackedRef.current = true
        markCheckoutTracked(sessionId)
        void trackEvent('checkout_completed', {
          email: user.email || null,
          metadata: {
            stripe_session_id: sessionId,
          },
        })
        void trackEvent('payment_completed', {
          email: user.email || null,
          metadata: {
            stripe_session_id: sessionId,
          },
        })
        trackGaEvent('subscription_started', {
          // Checkout amount is not known here; do not report a hard-coded purchase value.
          billing_period: 'monthly',
          currency: 'USD',
          visitor_type: 'logged_in',
        })
      }

      await activate(sessionId)
      clearGuestTrialMode()
      router.replace('/dashboard')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'We could not verify your checkout')
    } finally {
      setVerifying(false)
    }
  }

  async function activate(currentSessionId: string) {
    // Only the session id is sent. The server syncs this customer's own subscription from Stripe; it imports nothing.
    const res = await fetch('/api/post-checkout/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId }),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      throw new Error(data?.error || 'Unable to unlock your workspace')
    }
  }

  return (
    <div className="w-full max-w-[460px] overflow-hidden rounded-[28px] border border-white/[0.12] bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(8,15,30,0.92))] p-6 shadow-[0_30px_90px_rgba(2,8,23,0.68)] backdrop-blur-2xl sm:p-8">
      <div className="mx-auto mb-10 flex w-fit items-center">
        <AlpaLogo className="h-8 w-auto object-contain" priority />
      </div>

      <div className="space-y-3 text-center">
        <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-white sm:text-[2.2rem]">
          Your access is being unlocked.
        </h1>
        <p className="text-sm leading-6 text-slate-400 sm:text-[15px]">
          We are finishing your upgrade and sending you into the dashboard.
        </p>
      </div>

      {verifying ? (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-slate-300">
          Verifying your checkout...
        </div>
      ) : errorMessage ? (
        <div className="mt-8 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-4 text-sm leading-6 text-rose-100">
          {errorMessage}
        </div>
      ) : needsLogin ? (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-6 text-slate-200">
          Log in to the account you paid from to finish unlocking your plan.{' '}
          <Link href={loginForPaymentHref(`/post-checkout?session_id=${sessionId}`)} className="font-medium text-cyan-200 transition hover:text-white">
            Log in
          </Link>
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-4 text-sm text-cyan-50">
          Redirecting you to your dashboard...
        </div>
      )}

      <div className="mt-6 text-center text-sm text-slate-400">
        Returning user?{' '}
        <Link href="/login" className="font-medium text-cyan-200 transition hover:text-white">
          Log in
        </Link>
      </div>
    </div>
  )
}
