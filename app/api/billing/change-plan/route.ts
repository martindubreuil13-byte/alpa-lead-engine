import { NextResponse } from 'next/server'
import { publicPlan } from '@/lib/billing/plans'
import { decidePlanChange } from '@/lib/billing/change-plan'
import { getConfiguredPrice, getPlanFromSubscription } from '@/lib/stripe'
import { getActiveSubscription, stripe, syncSubscriptionToDatabase } from '@/lib/stripe/subscription'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    if (req.headers.get('origin') !== new URL(req.url).origin) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const client = await createSupabaseServerClient()
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (process.env.ALPA_PLAN_CHANGES_ENABLED !== 'true') {
      return NextResponse.json({ error: 'Plan changes are not active yet. Existing subscriptions continue unchanged.' }, { status: 503 })
    }
    const body = await req.json().catch(() => null)
    const target = publicPlan(body?.plan)
    if (!target) return NextResponse.json({ error: 'Choose a valid plan.' }, { status: 400 })
    const { subscription } = await getActiveSubscription(user.id)
    if (!subscription || subscription.status !== 'active') {
      return NextResponse.json({ error: 'An active paid subscription is required.' }, { status: 409 })
    }
    if (subscription.cancel_at_period_end || subscription.pending_update) {
      return NextResponse.json({ error: 'Resolve the pending subscription change before changing plans.' }, { status: 409 })
    }
    let change
    try { change = decidePlanChange(getPlanFromSubscription(subscription), target) }
    catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 409 }) }
    const price = await getConfiguredPrice(target)
    const item = subscription.items.data[0]
    const scheduleId = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id
    const existingSchedule = scheduleId ? await stripe.subscriptionSchedules.retrieve(scheduleId) : null
    if (existingSchedule && (existingSchedule.metadata?.alpa_plan_change !== 'true' ||
        existingSchedule.metadata?.user_id !== user.id || existingSchedule.metadata?.target !== target)) {
      return NextResponse.json({ error: 'Resolve the pending subscription change before changing plans.' }, { status: 409 })
    }
    // Stable keys make retries safe. Never create a second subscription or touch saved businesses/usage.
    const key = `alpa-plan:${subscription.id}:${item.price.id}:${price}:${item.current_period_end}`
    if (change.downgrade) {
      if (!item.current_period_start || !item.current_period_end) throw new Error('Billing period unavailable')
      const schedule = existingSchedule ?? await stripe.subscriptionSchedules.create({ from_subscription: subscription.id, metadata: { alpa_plan_change: 'true', user_id: user.id, target } }, { idempotencyKey: `${key}:schedule` })
      await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          { start_date: item.current_period_start, end_date: item.current_period_end,
            items: [{ price: item.price.id, quantity: item.quantity ?? 1 }], proration_behavior: 'none' },
          { start_date: item.current_period_end, items: [{ price, quantity: 1 }], proration_behavior: 'none' },
        ],
      }, { idempotencyKey: `${key}:phases` })
      return NextResponse.json({ scheduled: true, effective_at: item.current_period_end,
        message: 'Starter is scheduled for your next billing date. Pro access continues until then. Your saved businesses and usage history are retained.' })
    }
    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price, quantity: 1 }],
      proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete', billing_cycle_anchor: 'unchanged',
    }, { idempotencyKey: key })
    await syncSubscriptionToDatabase(updated, { userId: user.id })
    return NextResponse.json({ effectivePlan: getPlanFromSubscription(updated), message: updated.pending_update
      ? 'Payment is required before Pro becomes active. Your current allowance remains in place.'
      : 'Pro is active. Businesses already used this month count toward your 500-business allowance.' })
  } catch (error) {
    console.error('[billing.change-plan] failed', error)
    return NextResponse.json({ error: 'Unable to confirm the plan change. Refresh billing before trying again.' }, { status: 503 })
  }
}
