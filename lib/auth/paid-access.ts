import type Stripe from 'stripe'

const EXPIRED_STRIPE_STATUSES = new Set(['canceled', 'incomplete_expired', 'unpaid'])
const PAID_THROUGH_PERIOD_STATUSES = new Set(['past_due', 'paused', 'unpaid'])
export const RETRIEVABLE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'paused',
  'unpaid',
  'canceled',
])

type SubscriptionAccessState = {
  status?: string | null
  cancelAtPeriodEnd?: boolean | null
  currentPeriodEnd?: string | null
}

export function isFutureIsoDate(value: string | null | undefined) {
  if (!value) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.getTime() > Date.now()
}

export function hasActivePaidAccessState({
  status,
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: SubscriptionAccessState) {
  const normalizedStatus = String(status || '').trim()
  const periodStillActive = isFutureIsoDate(currentPeriodEnd)

  if (normalizedStatus === 'active' || normalizedStatus === 'trialing') {
    return true
  }

  if (cancelAtPeriodEnd && periodStillActive) {
    return true
  }

  if (PAID_THROUGH_PERIOD_STATUSES.has(normalizedStatus) && periodStillActive) {
    return true
  }

  if (EXPIRED_STRIPE_STATUSES.has(normalizedStatus)) {
    return periodStillActive
  }

  return false
}

export function hasActivePaidAccess(subscription: Stripe.Subscription) {
  const currentPeriodEnd = (
    subscription as Stripe.Subscription & { current_period_end?: number | null }
  ).current_period_end

  return hasActivePaidAccessState({
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
  })
}
