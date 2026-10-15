import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { createStripeCustomer, createStarterCheckoutSession, createProCheckoutSession } from '@/lib/stripe'
import { parseCheckoutPlan } from '@/lib/checkout/pending-plan'
import { decideNewCheckout } from '@/lib/stripe/checkout-guard'
import { getActiveSubscription } from '@/lib/stripe/subscription'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type CheckoutRequestBody = {
  source?: string | null
  plan?: string | null
}

// Checkout is for a signed-in customer only. The account, the email and the Stripe customer all come from the session and
// that customer's own profile, never from the request body, so a caller cannot start a checkout for someone else's account
// or attach another account's Stripe customer to theirs.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as CheckoutRequestBody | null
    const requestedPlan = parseCheckoutPlan(body?.plan)
    if (!requestedPlan) return NextResponse.json({ error: 'Choose a valid ALPA plan.' }, { status: 400 })
    const origin = new URL(req.url).origin
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id || !user.email) {
      return NextResponse.json(
        { error: 'Log in or create an account to continue.', code: 'auth_required' },
        { status: 401 }
      )
    }

    const userId = user.id
    const userEmail = user.email.trim().toLowerCase()

    const { data: profile, error: profileLookupError } = await admin
      .from('profiles')
      .select('plan, plan_status, stripe_customer_id, stripe_subscription_id')
      .eq('id', userId)
      .maybeSingle()

    if (profileLookupError) {
      throw new Error(profileLookupError.message)
    }

    // One live subscription per account. Stripe's own view decides (the profile can lag a webhook), with the local record as
    // a second check.
    const { subscription: liveSubscription } = await getActiveSubscription(userId)
    const decision = decideNewCheckout({ profile, liveSubscription })

    if (!decision.ok) {
      return NextResponse.json({ error: decision.message, code: decision.code }, { status: decision.status })
    }

    const customer = await createStripeCustomer({
      customerId: profile?.stripe_customer_id ?? null,
      email: userEmail,
      userId,
      source: body?.source || null,
    })

    // The customer is attached only to the profile that is checking out, and only when it has none or its own is replaced
    // (deleted in Stripe). Another profile's customer id can never be written here: it is never read from the request.
    if (profile?.stripe_customer_id !== customer.id) {
      const { error: profileError } = await admin
        .from('profiles')
        .upsert({ id: userId, stripe_customer_id: customer.id }, { onConflict: 'id' })

      if (profileError) {
        throw new Error(profileError.message)
      }
    }


    const checkoutParams = {
      origin,
      customerId: customer.id,
      userId,
      userEmail,
      source: body?.source || null,
    }

    const session = requestedPlan === 'pro'
      ? await createProCheckoutSession(checkoutParams)
      : await createStarterCheckoutSession(checkoutParams)

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[checkout] unable to start checkout', error)
    return NextResponse.json({ error: 'Unable to start checkout' }, { status: 500 })
  }
}
