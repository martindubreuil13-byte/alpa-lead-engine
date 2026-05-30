import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserProfile } from '@/lib/supabase/types'
import { resolveUserSubscription } from '@/lib/auth/resolve-user-subscription'

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

  const subscription = await resolveUserSubscription(user.id, { email: user.email })

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
    created_at: profile?.created_at ?? user.created_at ?? new Date().toISOString(),
  }
}
