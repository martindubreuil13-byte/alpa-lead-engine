// What the database alone says about a person's subscription, and when Stripe needs to be asked. Pure (no Stripe, no database), so
// it can be tested offline and shared between the live resolver and the outage fallback.
import { hasActivePaidAccessState, isFutureIsoDate } from './paid-access.ts'
import type { UserPlan } from '../supabase/types.ts'

export type ResolvedUserSubscription = {
  plan: UserPlan
  plan_status: string
  subscription_active: boolean
  cancel_at_period_end: boolean
  current_period_end: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_tier: UserPlan
}

export type ProfileRow = {
  id: string
  plan: UserPlan | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
  plan_status: string | null
  cancel_at_period_end: boolean | null
  current_period_end: string | null
  canceled_at: string | null
  subscription_tier: UserPlan | null
  created_at?: string | null
}

export type UserRow = {
  id: string
  email: string | null
  plan: UserPlan | null
}

export function normalizePlan(plan: string | null | undefined): UserPlan {
  if (plan === 'admin' || plan === 'pro' || plan === 'prospector' || plan === 'starter') {
    return plan
  }

  return 'free'
}

export function normalizeStatus(status: string | null | undefined, plan: UserPlan) {
  if (status) return status
  return plan === 'free' ? 'free' : 'active'
}

export function getLocalSubscriptionState(profile: ProfileRow | null, userPlan: UserPlan): ResolvedUserSubscription {
  const storedTier = normalizePlan(profile?.subscription_tier)
  const plan = storedTier !== 'free' ? storedTier : normalizePlan(profile?.plan ?? userPlan)
  const planStatus = normalizeStatus(profile?.plan_status ?? profile?.subscription_status, plan)
  const cancelAtPeriodEnd = Boolean(profile?.cancel_at_period_end)
  const subscriptionActive = hasActivePaidAccessState({
    status: planStatus,
    cancelAtPeriodEnd,
    currentPeriodEnd: profile?.current_period_end,
  })

  return {
    plan: subscriptionActive ? plan : plan === 'admin' ? 'admin' : 'free',
    plan_status: subscriptionActive ? planStatus : plan === 'admin' ? 'active' : 'free',
    subscription_active: subscriptionActive || plan === 'admin',
    cancel_at_period_end: cancelAtPeriodEnd,
    current_period_end: profile?.current_period_end ?? null,
    stripe_customer_id: profile?.stripe_customer_id ?? null,
    stripe_subscription_id: profile?.stripe_subscription_id ?? null,
    subscription_tier: normalizePlan(profile?.subscription_tier ?? plan),
  }
}

/**
 * Whether the live subscription must be looked up in Stripe. `navigation` is ordinary page navigation, where a free member who has
 * never been linked to Stripe (no customer, no subscription) has nothing to look up; every paid action asks without that shortcut.
 */
export function shouldRefreshStripe(profile: ProfileRow | null, forceRefresh: boolean, navigation = false) {
  if (forceRefresh) return true
  if (!profile) return true
  if (navigation && (profile.plan === 'free' || !profile.plan) && !profile.stripe_customer_id && !profile.stripe_subscription_id) return false
  if (!profile.stripe_subscription_id) return true
  if (!profile.stripe_subscription_id && !profile.stripe_customer_id) return true
  if (profile.plan === 'free') return true
  if (profile.plan_status === 'free' || profile.subscription_status === 'free') return true
  if (profile.cancel_at_period_end && !isFutureIsoDate(profile.current_period_end)) return true
  return false
}

