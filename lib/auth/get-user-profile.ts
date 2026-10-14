import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserProfile } from '@/lib/supabase/types'
import { readStoredSubscription, resolveUserSubscription } from '@/lib/auth/resolve-user-subscription'
import { resolveSubscriptionForNavigation } from '@/lib/auth/subscription-display'

export async function getUserProfile(): Promise<UserProfile | null> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (!user || error) {
    return null
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'plan, stripe_customer_id, stripe_subscription_id, subscription_status, plan_status, cancel_at_period_end, current_period_end, canceled_at, subscription_tier, created_at'
    )
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.plan === 'admin') {
    return {
      id: user.id,
      email: user.email ?? '',
      role: 'admin',
      plan: 'admin',
      stripe_customer_id: profile.stripe_customer_id,
      stripe_subscription_id: profile.stripe_subscription_id,
      subscription_status: profile.plan_status ?? profile.subscription_status,
      plan_status: profile.plan_status,
      cancel_at_period_end: profile.cancel_at_period_end,
      current_period_end: profile.current_period_end,
      canceled_at: profile.canceled_at,
      subscription_tier: profile.subscription_tier,
      subscription_active: true,
      created_at: profile.created_at ?? user.created_at ?? new Date().toISOString(),
    }
  }

  // Ordinary navigation: ask Stripe only briefly (and not at all for a free member never linked to Stripe); if it does not answer,
  // show the stored plan and grant nothing from it (see lib/auth/subscription-display.ts).
  const subscription = await resolveSubscriptionForNavigation({
    resolveLive: () => resolveUserSubscription(user.id, { email: user.email, navigation: true }),
    readStored: () => readStoredSubscription(user.id),
    onFallback: (reason) => console.warn('[subscription.display] using stored plan, not verified', { reason }),
  })

  const plan = subscription.plan

  return {
    id: user.id,
    email: user.email ?? '',
    role: plan === 'admin' ? 'admin' : 'user',
    plan,
    stripe_customer_id: subscription.stripe_customer_id,
    stripe_subscription_id: subscription.stripe_subscription_id,
    subscription_status: subscription.plan_status,
    plan_status: subscription.plan_status,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: subscription.current_period_end,
    subscription_tier: subscription.subscription_tier,
    subscription_active: subscription.subscription_active,
    plan_verified: subscription.verified,
    created_at: profile?.created_at ?? user.created_at ?? new Date().toISOString(),
  }
}
