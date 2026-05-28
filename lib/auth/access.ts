import type { UserProfile } from '@/lib/supabase/types'

export function isAdminPlan(plan: string | null | undefined) {
  return plan === 'admin'
}

export function isPaidPlan(plan: string | null | undefined) {
  return plan === 'prospector' || plan === 'starter' || plan === 'pro'
}

function isFutureDate(value: string | null | undefined) {
  if (!value) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now()
}

function hasBillableAccess(user: UserProfile | null) {
  if (!user) return false
  if (user.subscription_active) return true

  const status = user.plan_status ?? user.subscription_status ?? null

  if (status === 'canceled' || status === 'incomplete_expired') {
    return false
  }

  if (status === 'canceling') {
    return isFutureDate(user.current_period_end)
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
    if (user.plan === 'prospector') return false
    if (feature === 'pipeline' || feature === 'templates' || feature === 'email') return true
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
