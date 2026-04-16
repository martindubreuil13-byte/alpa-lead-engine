import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const requestSchema = z.object({
  queueId: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'save']),
  payload: z
    .object({
      subject: z.string().trim().max(200).optional(),
      full_email: z.string().trim().max(5000).optional(),
      hook: z.string().trim().max(600).optional(),
      body: z.string().trim().max(2000).optional(),
      cta: z.string().trim().max(400).optional(),
    })
    .optional(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 })
    }

    const { queueId, action, payload } = parsed.data

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== userId) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    // Ensure the item belongs to this user
    const { data: existing, error: fetchError } = await supabase
      .from('outreach_queue')
      .select('id, review_status')
      .eq('id', queueId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
    }

    const now = new Date().toISOString()

    let update: Record<string, unknown> = { updated_at: now }

    if (action === 'approve') {
      update = {
        ...update,
        review_status: 'approved',
        approved_at: now,
        ...(payload?.subject !== undefined && { subject: payload.subject }),
        ...(payload?.full_email !== undefined && { full_email: payload.full_email }),
        ...(payload?.hook !== undefined && { hook: payload.hook }),
        ...(payload?.body !== undefined && { body: payload.body }),
        ...(payload?.cta !== undefined && { cta: payload.cta }),
      }
    } else if (action === 'reject') {
      update = {
        ...update,
        review_status: 'rejected',
        rejected_at: now,
      }
    } else {
      // save — preserve current review_status, only update content
      update = {
        ...update,
        ...(payload?.subject !== undefined && { subject: payload.subject }),
        ...(payload?.full_email !== undefined && { full_email: payload.full_email }),
        ...(payload?.hook !== undefined && { hook: payload.hook }),
        ...(payload?.body !== undefined && { body: payload.body }),
        ...(payload?.cta !== undefined && { cta: payload.cta }),
      }
    }

    const { error: updateError } = await supabase
      .from('outreach_queue')
      .update(update)
      .eq('id', queueId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[outreach-queue/update] update error:', updateError)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }

    return NextResponse.json({ success: true, action })
  } catch (error) {
    console.error('[outreach-queue/update] error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
