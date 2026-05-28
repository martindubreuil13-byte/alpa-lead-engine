import Stripe from 'stripe'

import {
  hasActivePaidAccess,
  hasActivePaidAccessState,
  isFutureIsoDate,
  RETRIEVABLE_SUBSCRIPTION_STATUSES,
} from '@/lib/auth/paid-access'
import type { UserPlan } from '@/lib/supabase/types'
import {
  createSupabaseAdminClient,
  getCurrentPeriodEnd,
  getStripeCustomerId,
  stripe,
  syncSubscriptionToDatabase,
} from '@/lib/stripe/subscription'
import { getPlanFromSubscription } from '@/lib/stripe'

type ResolveUserSubscriptionOptions = {
  email?: string | null
  forceRefresh?: boolean
}

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

type ProfileRow = {
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

type UserRow = {
  id: string
  email: string | null
  plan: UserPlan | null
}

function normalizePlan(plan: string | null | undefined): UserPlan {
  if (plan === 'admin' || plan === 'pro' || plan === 'prospector' || plan === 'starter') {
    return plan
  }

  return 'free'
}

function normalizeStatus(status: string | null | undefined, plan: UserPlan) {
  if (status) return status
  return plan === 'free' ? 'free' : 'active'
}

function getResolvedStripeStatus(subscription: Stripe.Subscription) {
  if (subscription.status === 'canceled') return 'canceled'
  if (subscription.cancel_at_period_end) return 'canceling'
  return subscription.status
}

function getSubscriptionTier(subscription: Stripe.Subscription): UserPlan {
  if (!hasActivePaidAccess(subscription)) return 'free'
  return getPlanFromSubscription(subscription)
}

function getLocalSubscriptionState(profile: ProfileRow | null, userPlan: UserPlan): ResolvedUserSubscription {
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

async function retrieveCustomer(customerId: string) {
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if ('deleted' in customer && customer.deleted) return null
    return customer
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError && error.statusCode === 404) {
      return null
    }
    throw error
  }
}

async function retrieveSubscription(subscriptionId: string) {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId)
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError && error.statusCode === 404) {
      return null
    }
    throw error
  }
}

async function listCustomerSubscriptions(customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
  })

  return subscriptions.data
}

async function findStripeCustomersForUser(userId: string, email: string | null) {
  const customersById = new Map<string, Stripe.Customer>()

  const metadataMatches = await stripe.customers.search({
    query: `metadata['user_id']:'${userId}'`,
    limit: 10,
  })
  metadataMatches.data.forEach((customer) => {
    if (!customer.deleted) customersById.set(customer.id, customer)
  })

  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (normalizedEmail) {
    const emailMatches = await stripe.customers.list({
      email: normalizedEmail,
      limit: 10,
    })
    emailMatches.data.forEach((customer) => {
      if (!customer.deleted) customersById.set(customer.id, customer)
    })
  }

  return [...customersById.values()]
}

function pickBestSubscription(subscriptions: Stripe.Subscription[]) {
  return (
    subscriptions
      .filter((subscription) => RETRIEVABLE_SUBSCRIPTION_STATUSES.has(subscription.status))
      .sort((left, right) => {
        const leftActive = hasActivePaidAccess(left) ? 1 : 0
        const rightActive = hasActivePaidAccess(right) ? 1 : 0
        if (leftActive !== rightActive) return rightActive - leftActive

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

async function findAuthoritativeStripeSubscription({
  userId,
  email,
  profile,
}: {
  userId: string
  email: string | null
  profile: ProfileRow | null
}) {
  const subscriptionId = String(profile?.stripe_subscription_id || '').trim()

  if (subscriptionId) {
    const subscription = await retrieveSubscription(subscriptionId)
    if (subscription && RETRIEVABLE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      return subscription
    }
  }

  const customerId = String(profile?.stripe_customer_id || '').trim()
  if (customerId) {
    const customer = await retrieveCustomer(customerId)
    if (customer) {
      const subscription = pickBestSubscription(await listCustomerSubscriptions(customer.id))
      if (subscription) return subscription
    }
  }

  const customers = await findStripeCustomersForUser(userId, email)
  const subscriptionGroups = await Promise.all(
    customers.map(async (customer) => listCustomerSubscriptions(customer.id))
  )

  return pickBestSubscription(subscriptionGroups.flat())
}

function shouldRefreshStripe(profile: ProfileRow | null, forceRefresh: boolean) {
  if (forceRefresh) return true
  if (!profile) return true
  if (!profile.stripe_subscription_id) return true
  if (!profile.stripe_subscription_id && !profile.stripe_customer_id) return true
  if (profile.plan === 'free') return true
  if (profile.plan_status === 'free' || profile.subscription_status === 'free') return true
  if (profile.cancel_at_period_end && !isFutureIsoDate(profile.current_period_end)) return true
  return false
}

export async function resolveUserSubscription(
  userId: string,
  options: ResolveUserSubscriptionOptions = {}
): Promise<ResolvedUserSubscription> {
  const supabase = createSupabaseAdminClient()
  const normalizedUserId = String(userId || '').trim()

  if (!normalizedUserId) {
    throw new Error('Missing user id')
  }

  const [{ data: profile }, { data: userRow }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, plan, stripe_customer_id, stripe_subscription_id, subscription_status, plan_status, cancel_at_period_end, current_period_end, canceled_at, subscription_tier, created_at'
      )
      .eq('id', normalizedUserId)
      .maybeSingle(),
    supabase
      .from('users')
      .select('id, email, plan')
      .eq('id', normalizedUserId)
      .maybeSingle(),
  ])

  const localProfile = (profile ?? null) as ProfileRow | null
  const localUser = (userRow ?? null) as UserRow | null
  const email = String(options.email || localUser?.email || '').trim().toLowerCase() || null
  const localState = getLocalSubscriptionState(localProfile, normalizePlan(localUser?.plan))
  const refreshStripe = shouldRefreshStripe(localProfile, Boolean(options.forceRefresh))

  let resolvedState = localState

  if (refreshStripe) {
    const subscription = await findAuthoritativeStripeSubscription({
      userId: normalizedUserId,
      email,
      profile: localProfile,
    })

    if (subscription) {
      const synced = await syncSubscriptionToDatabase(subscription, {
        userId: normalizedUserId,
        customerId: getStripeCustomerId(subscription.customer),
      })
      const subscriptionTier = getSubscriptionTier(subscription)
      const planStatus = getResolvedStripeStatus(subscription)

      resolvedState = {
        plan: subscriptionTier,
        plan_status: planStatus,
        subscription_active: hasActivePaidAccess(subscription),
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_end: getCurrentPeriodEnd(subscription),
        stripe_customer_id: synced?.stripe_customer_id ?? getStripeCustomerId(subscription.customer) ?? null,
        stripe_subscription_id: subscription.id,
        subscription_tier: subscriptionTier,
      }
    } else if (
      localProfile &&
      localState.plan === 'free' &&
      localProfile.plan !== 'free' &&
      localProfile.plan !== 'admin'
    ) {
      const canceledAt = new Date().toISOString()
      const [profileUpdate, userUpdate] = await Promise.all([
        supabase
          .from('profiles')
          .update({
            plan: 'free',
            subscription_status: 'canceled',
            plan_status: 'canceled',
            cancel_at_period_end: false,
            current_period_end: null,
            canceled_at: canceledAt,
            subscription_tier: 'free',
          })
          .eq('id', normalizedUserId),
        supabase.from('users').update({ plan: 'free' }).eq('id', normalizedUserId),
      ])

      if (profileUpdate.error) throw new Error(profileUpdate.error.message)
      if (userUpdate.error) throw new Error(userUpdate.error.message)

      resolvedState = {
        ...localState,
        plan: 'free',
        plan_status: 'canceled',
        subscription_active: false,
        cancel_at_period_end: false,
        current_period_end: null,
        subscription_tier: 'free',
      }
    }
  }

  console.info('[subscription.resolve]', {
    auth_user_id: normalizedUserId,
    stripe_customer_id: resolvedState.stripe_customer_id,
    stripe_subscription_id: resolvedState.stripe_subscription_id,
    resolved_plan: resolvedState.plan,
    resolved_status: resolvedState.plan_status,
    subscription_active: resolvedState.subscription_active,
    cancel_at_period_end: resolvedState.cancel_at_period_end,
    current_period_end: resolvedState.current_period_end,
    reconciled_from_stripe: refreshStripe,
  })

  return resolvedState
}
