import type { UserProfile } from '@/lib/supabase/types'
import { hasActivePaidAccessState } from './paid-access.ts'

export function isAdminPlan(plan: string | null | undefined) {
  return plan === 'admin'
}

export function isPaidPlan(plan: string | null | undefined) {
  return plan === 'starter_100' || plan === 'prospector' || plan === 'starter' || plan === 'pro'
}

function hasBillableAccess(user: UserProfile | null) {
  if (!user) return false
  // A plan read from the database because Stripe was unreachable is for display only: it never grants paid access.
  if (user.plan_verified === false) return false
  if (user.subscription_active) return true

  const status = user.plan_status ?? user.subscription_status ?? null
  if (status) {
    return hasActivePaidAccessState({
      status,
      cancelAtPeriodEnd: user.cancel_at_period_end,
      currentPeriodEnd: user.current_period_end,
    })
  }

  return isPaidPlan(user.plan)
}

export function isAdmin(user: UserProfile | null) {
  return isAdminPlan(user?.plan) || user?.role === 'admin'
}

export function isPaid(user: UserProfile | null) {
  return hasBillableAccess(user)
}

export function isFree(user: UserProfile | null) {
  return !isAdmin(user) && !isPaid(user)
}

export function isStarter(user: UserProfile | null) {
  return user?.plan === 'starter'
}

export function canAccessFeature(feature: string, user: UserProfile | null) {
  if (!user) return false

  if (isAdmin(user) || isPaid(user)) {
    if (feature === 'leads' || feature === 'csv') return true
    // Prospector plan: search and export only — no pipeline, templates, or email outreach
    // Pipeline, templates and email outreach are retired for customers; admins only.
    if (feature === 'pipeline' || feature === 'templates' || feature === 'email') return isAdmin(user)
  }

  switch (feature) {
    case 'pipeline':
    case 'templates':
    case 'email':
      return false

    case 'leads':
    case 'csv':
      return true

    default:
      return false
  }
}
