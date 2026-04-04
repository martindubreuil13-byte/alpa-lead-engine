import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { createStripeCustomer, createStarterCheckoutSession } from '@/lib/stripe'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type CheckoutRequestBody = {
  email?: string | null
  source?: string | null
}

function normalizeEmail(email: string | null | undefined) {
  return String(email || '').trim().toLowerCase()
}

async function resolveCheckoutUserId(
  authenticatedUserId: string | null | undefined,
  email: string | null | undefined
) {
  if (authenticatedUserId) {
    return authenticatedUserId
  }

  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) {
    return null
  }

  const { data, error } = await admin
    .from('users')
    .select('id')
    .ilike('email', normalizedEmail)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.id ?? null
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as CheckoutRequestBody | null
    const origin = new URL(req.url).origin
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const userEmail = body?.email || user?.email || null

    if (!userEmail) {
      return new Response(JSON.stringify({ error: 'Email required before checkout' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    }

    const userId = await resolveCheckoutUserId(user?.id, userEmail)
    const { data: profile, error: profileLookupError } = userId
      ? await admin
          .from('profiles')
          .select('stripe_customer_id')
          .eq('id', userId)
          .maybeSingle()
      : { data: null, error: null }

    if (profileLookupError) {
      throw new Error(profileLookupError.message)
    }

    const customer = await createStripeCustomer({
      customerId: profile?.stripe_customer_id ?? null,
      email: userEmail,
      userId,
      source: body?.source || null,
    })

    if (userId) {
      const { error: profileError } = await admin
        .from('profiles')
        .upsert({ id: userId, stripe_customer_id: customer.id }, { onConflict: 'id' })

      if (profileError) {
        throw new Error(profileError.message)
      }
    }

    console.log('CHECKOUT SESSION PARAMS', {
      hasCustomer: Boolean(customer?.id),
      hasCustomerEmail: false,
      userEmail,
      userId,
    })

    const session = await createStarterCheckoutSession({
      origin,
      customerId: customer.id,
      userId: userId ?? null,
      userEmail,
      source: body?.source || null,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start checkout'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
