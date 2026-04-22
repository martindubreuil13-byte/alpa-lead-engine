import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const requestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
})

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('outreach_queue')
      .update({
        status: 'approved',
        review_status: 'approved',
        approved_at: now,
        updated_at: now,
      })
      .in('id', parsed.data.ids)
      .eq('user_id', user.id)

    if (error) {
      console.error('[outreach/batch-approve] update failed:', error)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[outreach/batch-approve] error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
