import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
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

    const { ids } = parsed.data

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const { error, count } = await supabase
      .from('outreach_queue')
      .delete({ count: 'exact' })
      .in('id', ids)
      .eq('user_id', userId)

    if (error) {
      console.error('[outreach-queue/delete] delete error:', error)
      return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 })
    }

    return NextResponse.json({ success: true, deleted: count ?? ids.length })
  } catch (err) {
    console.error('[outreach-queue/delete] error:', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
