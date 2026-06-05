'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { AlpaLogo } from '@/components/brand/AlpaLogo'
import { trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { clearGuestTrial, getGuestCaptureEmail, getGuestLeads } from '@/lib/guest-session'
import { trackEvent } from '@/lib/track'
import { clearGuestTrialMode } from '@/lib/session/guest-trial-mode'
import { supabase } from '@/lib/supabase'

export default function PostCheckoutAccountForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: userLoading } = useCurrentUser()
  const initializedRef = useRef(false)
  const checkoutTrackedRef = useRef(false)
  const sessionId = searchParams.get('session_id') || ''
  const storedGuestEmail = getGuestCaptureEmail()

  const [email, setEmail] = useState('')
  const [stripeCheckoutEmail, setStripeCheckoutEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verified, setVerified] = useState(false)
  const [verifying, setVerifying] = useState(true)
  const [existingUser, setExistingUser] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const emailToUse = stripeCheckoutEmail || storedGuestEmail || email

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
      if (storedGuestEmail) {
        setEmail(storedGuestEmail)
      }

      if (user?.email) {
        setExistingUser(true)
        setEmail(user.email)
      }

      if (!sessionId) {
        throw new Error('Missing checkout session id')
      }

      const res = await fetch(`/api/checkout/session?session_id=${encodeURIComponent(sessionId)}`)
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.verified) {
        throw new Error(data?.error || 'We could not verify your checkout')
      }

      if (data.email) {
        setStripeCheckoutEmail(data.email)
        setEmail(data.email)
      }

      setVerified(true)

      if (!checkoutTrackedRef.current && !hasTrackedCheckout(sessionId)) {
        checkoutTrackedRef.current = true
        markCheckoutTracked(sessionId)
        void trackEvent('checkout_completed', {
          email: data.email || storedGuestEmail || user?.email || null,
          metadata: {
            stripe_session_id: sessionId,
          },
        })
        void trackEvent('payment_completed', {
          email: data.email || storedGuestEmail || user?.email || null,
          metadata: {
            stripe_session_id: sessionId,
          },
        })
        trackGaEvent('subscription_started', {
          plan_name: 'starter',
          price: 29.99,
          billing_period: 'monthly',
          currency: 'USD',
          visitor_type: user?.id ? 'logged_in' : 'anonymous',
        })
      }

      if (user?.id) {
        await activateStarter(sessionId, false)
        clearGuestTrialMode()
        router.replace('/dashboard')
        return
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'We could not verify your checkout')
    } finally {
      setVerifying(false)
    }
  }

  async function activateStarter(currentSessionId: string, cleanWorkspace = false) {
    const res = await fetch('/api/post-checkout/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        cleanWorkspace,
        leads: getGuestLeads(),
      }),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      throw new Error(data?.error || 'Unable to unlock your workspace')
    }

    clearGuestTrial()
  }

  async function handleCreateAccount() {
    if (loading || !verified) return

    if (!emailToUse.trim()) {
      setErrorMessage('Enter your email to finish creating your account.')
      return
    }

    if (!password) {
      setErrorMessage('Set a password to continue.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setLoading(true)
    setErrorMessage('')

    try {
      const normalizedEmail = emailToUse.trim().toLowerCase()
      void trackEvent('signup_started', { email: normalizedEmail })
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      })

      if (error) {
        throw error
      }

      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        })

        if (signInError) {
          throw signInError
        }
      }

      void trackEvent('signup_completed', { email: normalizedEmail })
      void trackEvent('email_confirmed', { email: normalizedEmail })
      await activateStarter(sessionId, true)
      clearGuestTrialMode()
      router.replace('/dashboard')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create your account right now.'
      setErrorMessage(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-[460px] overflow-hidden rounded-[28px] border border-white/[0.12] bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(8,15,30,0.92))] p-6 shadow-[0_30px_90px_rgba(2,8,23,0.68)] backdrop-blur-2xl sm:p-8">
      <div className="mx-auto mb-10 flex w-fit items-center">
        <AlpaLogo className="h-8 w-auto object-contain" priority />
      </div>

      <div className="space-y-3 text-center">
        <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-white sm:text-[2.2rem]">
          Your access is unlocked. Create your account to access your workspace.
        </h1>
        <p className="text-sm leading-6 text-slate-400 sm:text-[15px]">
          {existingUser
            ? 'We are finishing your upgrade and sending you into the dashboard.'
            : 'Set your password once and we will bring your upgraded workspace online.'}
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
      ) : existingUser ? (
        <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-4 text-sm text-cyan-50">
          Redirecting you to your upgraded dashboard...
        </div>
      ) : (
        <form
          className="mt-8 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreateAccount()
          }}
        >
          <input
            type="email"
            autoComplete="email"
            value={emailToUse}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            className="h-14 w-full rounded-2xl border border-white/[0.10] bg-white/[0.06] px-4 text-[15px] text-white placeholder:text-slate-500 focus:border-cyan-300/45 focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
          />

          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Set password"
            className="h-14 w-full rounded-2xl border border-white/[0.10] bg-white/[0.06] px-4 text-[15px] text-white placeholder:text-slate-500 focus:border-cyan-300/45 focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
          />

          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirm password"
            className="h-14 w-full rounded-2xl border border-white/[0.10] bg-white/[0.06] px-4 text-[15px] text-white placeholder:text-slate-500 focus:border-cyan-300/45 focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
          />

          <button
            type="submit"
            disabled={loading}
            className="flex min-h-[58px] w-full items-center justify-center rounded-2xl border border-sky-300/30 bg-[linear-gradient(to_right,#3B82F6,#06B6D4)] px-4 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:scale-[1.02] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 disabled:hover:brightness-100"
          >
            {loading ? 'Creating account...' : 'Create my account'}
          </button>
        </form>
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
