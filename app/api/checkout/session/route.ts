import { NextResponse } from 'next/server'

import { getCheckoutSession } from '@/lib/stripe'
import { checkSessionOwnership, isSessionComplete } from '@/lib/stripe/checkout-guard'
import { createSupabaseAdminClient } from '@/lib/stripe/subscription'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// Tells a signed-in customer whether their own checkout completed. A session that is unknown or belongs to another account
// gets the same answer, and nothing about it (not even the email) is returned.
export async function GET(req: Request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      return NextResponse.json({ error: 'Log in to verify your checkout.', code: 'auth_required' }, { status: 401 })
    }

    const sessionId = new URL(req.url).searchParams.get('session_id')?.trim() || ''
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
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle()

    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || ''
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

    return NextResponse.json({ verified: isSessionComplete(session) })
  } catch (error) {
    console.error('[checkout.session] unable to verify checkout', error)
    return NextResponse.json({ error: 'Unable to verify checkout' }, { status: 400 })
  }
}
