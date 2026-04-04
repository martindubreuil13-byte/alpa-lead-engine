import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

import { getCheckoutEmail, getCheckoutSession, isCheckoutUnlocked } from '@/lib/stripe'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type ActivateRequestBody = {
  sessionId?: string
  mock?: boolean
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options)
              })
            } catch {}
          },
        },
      }
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as ActivateRequestBody | null
    const isMock = body?.mock === true

    if (!isMock) {
      const session = await getCheckoutSession(String(body?.sessionId || ''))

      if (!isCheckoutUnlocked(session)) {
        return NextResponse.json({ error: 'Checkout is not complete' }, { status: 400 })
      }

      const checkoutEmail = getCheckoutEmail(session)
      if (checkoutEmail && user.email?.trim().toLowerCase() !== checkoutEmail) {
        return NextResponse.json(
          { error: 'Checkout email does not match the authenticated user' },
          { status: 400 }
        )
      }
    }

    const { error: profileError } = await admin
      .from('profiles')
      .upsert({ id: user.id, plan: 'starter' }, { onConflict: 'id' })

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to activate account'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
