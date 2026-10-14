'use client'

import { useEffect, useState } from 'react'

import { getSourcePage, trackEvent as trackGaEvent } from '@/lib/analytics/ga'
import { isPaid } from '@/lib/auth/access'
import { useClientUserProfile } from '@/lib/auth/use-client-user-profile'
import { useCurrentUser } from '@/lib/auth/useCurrentUser'
import { getGuestCaptureEmail, saveGuestCaptureEmail } from '@/lib/guest-session'
import { trackEvent } from '@/lib/track'
import { parseCheckoutSource, savePendingCheckout, signupHref } from '@/lib/checkout/pending-plan'

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

    const normalizedEmail = String(user?.email || email || emailInput || getGuestCaptureEmail()).trim().toLowerCase()

    // Checkout belongs to an account: a visitor creates one (or logs in) first, then returns to choose a plan.
    if (!isAuthenticated) {
      if (normalizedEmail) saveGuestCaptureEmail(normalizedEmail)
      // The chosen plan travels with the visitor (in the address and in the browser) so signing up or in continues to checkout.
      try { savePendingCheckout(window.localStorage, { plan, source: parseCheckoutSource(source) }) } catch { /* the address carries it */ }
      window.location.href = signupHref(plan, source)
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
        body: JSON.stringify({ source, plan }),
      })

      const data = await res.json().catch(() => null)

      if (res.status === 401) {
        window.location.href = signupHref(plan, source)
        return
      }

      if (res.status === 409 && data?.code === 'already_subscribed') {
        window.location.href = '/dashboard/billing'
        return
      }

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
            : label}
      </button>
    </div>
  )
}
