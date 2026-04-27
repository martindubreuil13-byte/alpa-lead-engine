import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

type FollowUpBody = {
  sessionId?: string
  userId?: string | null
  email?: string | null
  followedUp?: boolean
  note?: string | null
}

function normalizeText(value: unknown) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
    if (authError || !user?.email || user.email.toLowerCase() !== adminEmail) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as FollowUpBody | null
    const sessionId = normalizeText(body?.sessionId)

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session id' }, { status: 400 })
    }

    const admin = createAdminClient()
    const payload: Database['public']['Tables']['activity_logs']['Insert'] = {
      session_id: sessionId,
      user_id: normalizeText(body?.userId),
      email: normalizeText(body?.email),
      event: 'admin_followup_updated',
      metadata: {
        followed_up: body?.followedUp === true,
        note: normalizeText(body?.note),
      },
    }

    const { error } = await (admin.from('activity_logs' as never) as any).insert(payload)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save follow-up'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
