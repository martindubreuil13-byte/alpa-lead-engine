// The free-to-paid conversion moment: who it is for, and exactly what may be said.
//
// THE DISCOUNT IS NOT ACTIVE. Nothing here talks to Stripe, creates a coupon, changes a price or reaches checkout. While
// `FIRST_MONTH_OFFER.status` is 'preview' every screen that mentions the offer says plainly that it is not active yet, and no
// button implies it is applied. Switching it on is a billing change with its own review: see docs/free-to-paid-offer.md.

export const FIRST_MONTH_OFFER = {
  percentOff: 50,
  durationMonths: 1,
  /** 'preview' until Stripe can honour it and a test-mode purchase has proved it. Only a billing release changes this. */
  status: 'preview' as 'preview' | 'active',
}

export type OfferState = typeof FIRST_MONTH_OFFER

/** What brought the visitor here: all 25 free businesses used, or the 3 free searches used before reaching 25 businesses. */
export type ConversionKind = 'allowance' | 'searches'

export type OfferEligibility = { eligible: boolean; reason: 'guest' | 'new_free_member' | 'previous_subscriber' | 'paid' | 'administrator' }

type ProfileLike = {
  plan?: string | null
  role?: string | null
  plan_status?: string | null
  subscription_status?: string | null
  stripe_subscription_id?: string | null
  canceled_at?: string | null
  subscription_active?: boolean | null
} | null | undefined

const LAPSED = new Set(['canceled', 'canceling', 'incomplete_expired', 'unpaid', 'past_due', 'paused'])

/**
 * Whether the first-month offer is for this person. A visitor with no account is a guest: eligible. A free member is eligible only
 * if they have never had a subscription (the offer is for a FIRST month). Paid subscribers and administrators are never shown it.
 * This only chooses wording; whoever activates the offer must enforce the same rule on the server.
 */
export function describeOfferEligibility(profile: ProfileLike): OfferEligibility {
  if (!profile) return { eligible: true, reason: 'guest' }
  if (profile.plan === 'admin' || profile.role === 'admin') return { eligible: false, reason: 'administrator' }
  const status = String(profile.plan_status ?? profile.subscription_status ?? '')
  const paidNow = ['prospector', 'starter', 'pro'].includes(String(profile.plan)) || profile.subscription_active === true || status === 'active' || status === 'trialing'
  if (paidNow) return { eligible: false, reason: 'paid' }
  const hadSubscription = Boolean(profile.stripe_subscription_id) || Boolean(profile.canceled_at) || LAPSED.has(status)
  if (hadSubscription) return { eligible: false, reason: 'previous_subscriber' }
  return { eligible: true, reason: 'new_free_member' }
}

export type ConversionCopy = {
  headline: string
  support: string
  /** The offer line, or null when the visitor is not eligible (they see plain plans, no discount). */
  offerLine: string | null
  offerBadge: string | null
  /** The terms, shown with the offer. */
  terms: string | null
  /** Said whenever the offer is mentioned and not yet active. Null once it genuinely is. */
  inactiveNotice: string | null
  activeNotice: string | null
  primaryCta: string
  secondaryCta: string
}

export function buildConversionCopy(input: { kind: ConversionKind; saved: number; eligible: boolean; offer?: OfferState }): ConversionCopy {
  const offer = input.offer ?? FIRST_MONTH_OFFER
  const active = offer.status === 'active'
  const headline = input.kind === 'allowance' ? "You've discovered your 25 free businesses." : "You've used your three free searches."
  const support =
    input.kind === 'allowance'
      ? 'Ready to find more?'
      : `You discovered ${input.saved} ${input.saved === 1 ? 'business' : 'businesses'} across them, before reaching your 25. Ready to find more?`
  const base = { headline, support, primaryCta: 'Explore ALPA plans →', secondaryCta: 'View my businesses →' }
  if (!input.eligible) return { ...base, offerLine: null, offerBadge: null, terms: null, inactiveNotice: null, activeNotice: null }
  return {
    ...base,
    offerLine: `Enjoy ${offer.percentOff}% off your first month of ALPA when you upgrade.`,
    offerBadge: active ? 'First month' : 'Upcoming offer · not active yet',
    terms: 'The discount applies to your first month only. Regular pricing resumes afterward.',
    inactiveNotice: active ? null : 'This offer is not active yet, so nothing is discounted today. Plans are shown at their regular price until it is available.',
    activeNotice: active ? 'The discount is applied at checkout.' : null,
  }
}
