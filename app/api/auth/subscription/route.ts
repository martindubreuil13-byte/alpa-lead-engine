import { NextResponse } from 'next/server'

import { resolveUserSubscription } from '@/lib/auth/resolve-user-subscription'
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

    const subscription = await resolveUserSubscription(user.id, {
      email: user.email,
    })

    return NextResponse.json({ subscription })
  } catch (error) {
    console.error('[auth.subscription] failed', error)
    const message = error instanceof Error ? error.message : 'Unable to resolve subscription'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
