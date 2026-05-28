import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { STRIPE_API_VERSION, getPlanFromSubscription } from '@/lib/stripe'

export type BillingPlan = 'free' | 'prospector' | 'starter'
export type BillingPlanStatus =
  | 'active'
  | 'canceling'
  | 'canceled'
  | 'trialing'
  | 'past_due'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused'
  | 'free'

type ProfileSubscriptionRow = {
  id: string
  plan?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  plan_status?: string | null
  current_period_end?: string | null
  canceled_at?: string | null
}

type SubscriptionSyncOptions = {
  userId?: string | null
  customerId?: string | null
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
})

export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export function toIsoDate(timestamp: number | null | undefined) {
  if (!timestamp) return null
  return new Date(timestamp * 1000).toISOString()
}

export function getStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
) {
  if (!customer) return ''
  return typeof customer === 'string' ? customer.trim() : customer.id.trim()
}

export function getStripeSubscriptionId(
  subscription: string | Stripe.Subscription | null | undefined
) {
  if (!subscription) return ''
  return typeof subscription === 'string' ? subscription.trim() : subscription.id.trim()
}

export function getCurrentPeriodEnd(subscription: Stripe.Subscription) {
  return toIsoDate(
    (subscription as Stripe.Subscription & { current_period_end?: number | null })
      .current_period_end
  )
}

function getCanceledAt(subscription: Stripe.Subscription) {
  return toIsoDate(subscription.canceled_at)
}

function getSubscriptionPlanStatus(subscription: Stripe.Subscription): BillingPlanStatus {
  if (subscription.status === 'canceled') return 'canceled'
  if (subscription.cancel_at_period_end) return 'canceling'
  return subscription.status as BillingPlanStatus
}

function isEndedSubscription(subscription: Stripe.Subscription) {
  return subscription.status === 'canceled' || subscription.status === 'incomplete_expired'
}

function getSubscriptionTier(subscription: Stripe.Subscription): BillingPlan {
  return isEndedSubscription(subscription) ? 'free' : getPlanFromSubscription(subscription)
}

function isUsableSubscription(subscription: Stripe.Subscription) {
  return ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(subscription.status)
}

async function findProfileByUserId(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, plan, stripe_customer_id, stripe_subscription_id, plan_status, current_period_end, canceled_at')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as ProfileSubscriptionRow | null
}

async function findProfileByCustomerId(supabase: SupabaseClient, customerId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, plan, stripe_customer_id, stripe_subscription_id, plan_status, current_period_end, canceled_at')
    .eq('stripe_customer_id', customerId)
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? null) as ProfileSubscriptionRow | null
}

async function listLatestUsableSubscription(customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  })

  return (
    subscriptions.data
      .filter(isUsableSubscription)
      .sort((left, right) => {
        const leftEnd =
          (left as Stripe.Subscription & { current_period_end?: number | null })
            .current_period_end ?? left.created
        const rightEnd =
          (right as Stripe.Subscription & { current_period_end?: number | null })
            .current_period_end ?? right.created
        return rightEnd - leftEnd
      })[0] ?? null
  )
}

export async function getActiveSubscription(userId: string) {
  const supabase = createSupabaseAdminClient()
  const profile = await findProfileByUserId(supabase, userId)

  if (!profile) {
    return { profile: null, subscription: null }
  }

  const subscriptionId = String(profile.stripe_subscription_id || '').trim()

  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      if (isUsableSubscription(subscription)) {
        return { profile, subscription }
      }
      return { profile, subscription: null }
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError && error.statusCode === 404) {
        return { profile, subscription: null }
      }
      throw error
    }
  }

  const customerId = String(profile.stripe_customer_id || '').trim()
  if (!customerId) {
    return { profile, subscription: null }
  }

  try {
    const customer = await stripe.customers.retrieve(customerId)
    if ('deleted' in customer && customer.deleted) {
      return { profile, subscription: null }
    }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError && error.statusCode === 404) {
      return { profile, subscription: null }
    }
    throw error
  }

  return { profile, subscription: await listLatestUsableSubscription(customerId) }
}

export async function cancelSubscription(subscriptionId: string) {
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  })
}

export async function resumeSubscription(subscriptionId: string) {
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  })
}

export async function syncSubscriptionToDatabase(
  subscription: Stripe.Subscription,
  options: SubscriptionSyncOptions = {}
) {
  const supabase = createSupabaseAdminClient()
  const customerId = getStripeCustomerId(
    subscription.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null
  )
  let userId = String(options.userId || '').trim()
  let profile: ProfileSubscriptionRow | null = null

  if (!userId && customerId) {
    profile = await findProfileByCustomerId(supabase, customerId)
    userId = profile?.id ?? ''
  }

  if (!userId) {
    return null
  }

  if (!profile) {
    profile = await findProfileByUserId(supabase, userId)
  }

  const planStatus = getSubscriptionPlanStatus(subscription)
  const subscriptionTier = getSubscriptionTier(subscription)
  const currentPeriodEnd = getCurrentPeriodEnd(subscription)
  const canceledAt = getCanceledAt(subscription)

  if (profile?.plan_status === 'canceled' && planStatus !== 'canceled') {
    const localCanceledAt = profile.canceled_at ? new Date(profile.canceled_at).getTime() : 0
    const incomingPeriodEnd = currentPeriodEnd ? new Date(currentPeriodEnd).getTime() : 0

    if (localCanceledAt && incomingPeriodEnd && incomingPeriodEnd <= localCanceledAt) {
      return {
        userId,
        ignored: true,
        plan: 'free',
        plan_status: 'canceled',
        subscription_status: 'canceled',
        cancel_at_period_end: false,
        current_period_end: profile.current_period_end ?? null,
        canceled_at: profile.canceled_at,
        subscription_tier: 'free',
      }
    }
  }
  const accessPlan = subscriptionTier
  const profileUpdates = {
    plan: accessPlan,
    stripe_customer_id: customerId || options.customerId || null,
    stripe_subscription_id: subscription.id,
    subscription_status: planStatus,
    plan_status: planStatus,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: currentPeriodEnd,
    canceled_at: canceledAt,
    subscription_tier: subscriptionTier,
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: userId, ...profileUpdates }, { onConflict: 'id' })

  if (profileError) throw new Error(profileError.message)

  const { error: userError } = await supabase
    .from('users')
    .update({ plan: accessPlan })
    .eq('id', userId)

  if (userError) throw new Error(userError.message)

  return {
    userId,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId || options.customerId || null,
    plan_status: planStatus,
    subscription_status: planStatus,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: currentPeriodEnd,
    canceled_at: canceledAt,
    subscription_tier: subscriptionTier,
    plan: accessPlan,
  }
}

export async function syncCustomerSubscriptionState(customerId: string) {
  const supabase = createSupabaseAdminClient()
  const profile = await findProfileByCustomerId(supabase, customerId)

  if (!profile) return null

  const subscription = await listLatestUsableSubscription(customerId)

  if (subscription) {
    return syncSubscriptionToDatabase(subscription, { userId: profile.id, customerId })
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      plan: 'free',
      subscription_status: 'canceled',
      plan_status: 'canceled',
      cancel_at_period_end: false,
      current_period_end: null,
      canceled_at: new Date().toISOString(),
      subscription_tier: 'free',
    })
    .eq('id', profile.id)

  if (profileError) throw new Error(profileError.message)

  const { error: userError } = await supabase
    .from('users')
    .update({ plan: 'free' })
    .eq('id', profile.id)

  if (userError) throw new Error(userError.message)

  return {
    userId: profile.id,
    plan: 'free',
    plan_status: 'canceled',
    subscription_status: 'canceled',
    cancel_at_period_end: false,
    current_period_end: null,
    canceled_at: new Date().toISOString(),
    subscription_tier: 'free',
  }
}
