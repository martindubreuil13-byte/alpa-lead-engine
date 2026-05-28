import { NextResponse } from 'next/server'

import {
  getActiveSubscription,
  getCurrentPeriodEnd,
  resumeSubscription,
  syncSubscriptionToDatabase,
} from '@/lib/stripe/subscription'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { subscription } = await getActiveSubscription(user.id)

    if (!subscription) {
      return NextResponse.json({ error: 'No active Stripe subscription found' }, { status: 404 })
    }

    if (subscription.status === 'canceled') {
      return NextResponse.json({ error: 'Subscription has already ended' }, { status: 409 })
    }

    const updatedSubscription = subscription.cancel_at_period_end
      ? await resumeSubscription(subscription.id)
      : subscription
    const syncState = await syncSubscriptionToDatabase(updatedSubscription, { userId: user.id })
    const synced = syncState as {
      plan_status?: string
      subscription_status?: string
      stripe_customer_id?: string | null
      stripe_subscription_id?: string | null
    } | null

    return NextResponse.json({
      status: updatedSubscription.status,
      plan_status: synced?.plan_status ?? synced?.subscription_status ?? updatedSubscription.status,
      subscription_status: synced?.subscription_status ?? updatedSubscription.status,
      subscription_active: true,
      stripe_customer_id: synced?.stripe_customer_id ?? null,
      stripe_subscription_id: synced?.stripe_subscription_id ?? updatedSubscription.id,
      current_period_end: getCurrentPeriodEnd(updatedSubscription),
      cancel_at_period_end: updatedSubscription.cancel_at_period_end,
    })
  } catch (error) {
    console.error('[billing.resume] failed', error)
    const message = error instanceof Error ? error.message : 'Unable to resume subscription'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
