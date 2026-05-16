'use client'

import { useEffect, useState } from 'react'

import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { getGuestCaptureEmail, saveGuestCaptureEmail } from '@/lib/guest-session'
import { trackEvent } from '@/lib/track'

type CheckoutPlan = 'starter' | 'prospector'

const PLAN_META: Record<CheckoutPlan, { price: number; leadLimit: number }> = {
  starter:    { price: 29.99, leadLimit: 500 },
  prospector: { price: 9.99,  leadLimit: 120 },
}

type StartCheckoutButtonProps = {
  label: string
  className?: string
  wrapperClassName?: string
  email?: string | null
  source?: string
  plan?: CheckoutPlan
  disabled?: boolean
  disabledLabel?: string
}

export default function StartCheckoutButton({
  label,
  className,
  wrapperClassName,
  email,
  source = 'upgrade',
  plan = 'starter',
  disabled = false,
  disabledLabel = label,
}: StartCheckoutButtonProps) {
  const { user } = useCurrentUser()
  const { profile } = useClientUserProfile()
  const [loading, setLoading] = useState(false)
  const [emailInput, setEmailInput] = useState(() =>
    String(email || getGuestCaptureEmail()).trim().toLowerCase()
  )
  const [showEmailInput, setShowEmailInput] = useState(false)
  const isAuthenticated = Boolean(user?.id)
  const visitorType = isPaid(profile) ? 'paid' : isAuthenticated ? 'logged_in' : 'anonymous'

  function getCtaLocation() {
    if (source === 'scrape_completion') return 'post_trial_modal'
    if (source === 'plans_featured' || source === 'plans_footer') return 'pricing_page'
    if (source.includes('pricing')) return 'pricing_teaser'
    return 'other'
  }

  useEffect(() => {
    if (user?.email) {
      setEmailInput((current) => current || user.email!.trim().toLowerCase())
    }
  }, [user])

  useEffect(() => {
    if (email) {
      setEmailInput(String(email).trim().toLowerCase())
    }
  }, [email])

  async function handleCheckout() {
    if (loading || disabled) return

    const normalizedEmail = String(email || emailInput || getGuestCaptureEmail()).trim().toLowerCase()

    if (!isAuthenticated && !normalizedEmail) {
      setShowEmailInput(true)
      return
    }

    setLoading(true)

    if (normalizedEmail) {
      saveGuestCaptureEmail(normalizedEmail)
    }

    const { price: planPrice, leadLimit: planLeadLimit } = PLAN_META[plan]

    void trackEvent('upgrade_clicked', {
      email: normalizedEmail || null,
      metadata: {
        source,
        plan,
      },
    })
    trackGaEvent('upgrade_clicked', {
      plan_name: plan,
      price: planPrice,
      lead_limit: planLeadLimit,
      billing_period: 'monthly',
      source_page: getSourcePage(),
      cta_location: getCtaLocation(),
      visitor_type: visitorType,
    })

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail || null,
          source,
          plan,
        }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'Unable to start checkout')
      }

      void trackEvent('checkout_started', {
        email: normalizedEmail || null,
        metadata: {
          source,
          plan,
        },
      })
      trackGaEvent('checkout_started', {
        plan_name: plan,
        price: planPrice,
        lead_limit: planLeadLimit,
        billing_period: 'monthly',
        visitor_type: visitorType,
      })

      window.location.href = data.url
    } catch (error) {
      console.error('Checkout redirect failed:', error)
      setLoading(false)
    }
  }

  return (
    <div className={['space-y-3', wrapperClassName].filter(Boolean).join(' ')}>
      {showEmailInput && !isAuthenticated ? (
        <div className="space-y-2">
          <label className="text-sm text-gray-400">Email address</label>
          <input
            type="email"
            placeholder="Enter your email to continue"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            autoComplete="email"
            className="w-full rounded-lg border border-white/10 bg-[#020617] px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void handleCheckout()}
        disabled={disabled || loading}
        className={className}
      >
        {loading
          ? 'Redirecting...'
          : disabled
            ? disabledLabel
            : !isAuthenticated && showEmailInput
              ? 'Continue to Payment'
              : label}
      </button>
    </div>
  )
}
