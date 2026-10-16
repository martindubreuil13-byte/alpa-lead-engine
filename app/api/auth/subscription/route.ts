import { NextResponse } from 'next/server'

import { readStoredSubscription, resolveUserSubscription } from '@/lib/auth/resolve-user-subscription'
import { resolveSubscriptionForNavigation } from '@/lib/auth/subscription-display'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Display only: a Stripe outage degrades to the stored plan (verified: false), never to an error or to extra access.
    const subscription = await resolveSubscriptionForNavigation({
      resolveLive: () => resolveUserSubscription(user.id, { email: user.email, navigation: true }),
      readStored: () => readStoredSubscription(user.id),
    })

    return NextResponse.json({ subscription })
  } catch (error) {
    console.error('[auth.subscription] failed', error)
    const message = error instanceof Error ? error.message : 'Unable to resolve subscription'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
