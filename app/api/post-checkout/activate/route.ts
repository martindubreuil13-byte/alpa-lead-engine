import { NextResponse } from 'next/server'

import { getCheckoutSession } from '@/lib/stripe'
import {
  checkSessionOwnership,
  decideActivation,
  sessionCustomerId,
  sessionSubscriptionId,
} from '@/lib/stripe/checkout-guard'
import { hasActivePaidAccess } from '@/lib/auth/paid-access'
import { createSupabaseAdminClient, stripe, syncSubscriptionToDatabase } from '@/lib/stripe/subscription'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Finishes a checkout for the signed-in customer who started it. The only thing this does is sync that customer's own
// subscription from Stripe into their profile (the same sync the webhook performs). It accepts nothing from the browser but
// the session id: no leads are imported (new businesses are only ever saved through the credit-accounted discovery path)
// and nothing is deleted.
export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized', code: 'auth_required' }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as { sessionId?: unknown } | null
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing checkout session id' }, { status: 400 })
    }

    const session = await getCheckoutSession(sessionId).catch(() => null)
    if (!session) {
      return NextResponse.json({ error: 'Checkout session not found', code: 'session_not_found' }, { status: 404 })
    }

    const admin = createSupabaseAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('plan, plan_status, stripe_customer_id, stripe_subscription_id')
      .eq('id', user.id)
      .maybeSingle()

    const customerId = sessionCustomerId(session)
    const { data: holders } = customerId
      ? await admin.from('profiles').select('id').eq('stripe_customer_id', customerId).neq('id', user.id).limit(1)
      : { data: [] }

    const ownership = checkSessionOwnership(session, {
      userId: user.id,
      profileCustomerId: profile?.stripe_customer_id ?? null,
      otherProfileHoldsCustomer: Boolean(holders && holders.length > 0),
    })

    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.message, code: ownership.code }, { status: ownership.status })
    }

    const subscriptionId = sessionSubscriptionId(session)
    const subscription = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null

    const decision = decideActivation({
      session,
      subscription,
      subscriptionUsable: subscription ? hasActivePaidAccess(subscription) : false,
      profile,
    })

    if (!decision.ok || !subscription) {
      const refusal = decision.ok ? null : decision
      return NextResponse.json(
        { error: refusal?.message ?? 'Unable to activate this checkout', code: refusal?.code ?? 'no_subscription' },
        { status: refusal?.status ?? 409 }
      )
    }

    await syncSubscriptionToDatabase(subscription, { userId: user.id, customerId })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[post-checkout.activate] unable to activate', error)
    return NextResponse.json({ error: 'Unable to activate account' }, { status: 500 })
  }
}
