import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { id } = await req.json()

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Missing mission id' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    // Step 1: Mark as deleted first so any in-flight background jobs stop immediately
    const { error: markError } = await supabase
      .from('agent_missions')
      .update({ status: 'deleted' })
      .eq('id', id)
      .eq('user_id', userId)

    if (markError) {
      console.error('[missions/delete] mark deleted error:', markError)
      return NextResponse.json({ error: 'Failed to delete mission' }, { status: 500 })
    }

    // Step 2: Delete related rows
    const [leadQueueResult, outreachResult] = await Promise.all([
      supabase
        .from('agent_lead_queue')
        .delete()
        .eq('mission_id', id)
        .eq('user_id', userId),
      supabase
        .from('outreach_queue')
        .delete()
        .eq('mission_id', id)
        .eq('user_id', userId),
    ])

    if (leadQueueResult.error) {
      console.error('[missions/delete] lead_queue delete error (non-fatal):', leadQueueResult.error)
    }
    if (outreachResult.error) {
      console.error('[missions/delete] outreach_queue delete error (non-fatal):', outreachResult.error)
    }

    // Step 3: Hard delete the mission row
    const { error } = await supabase
      .from('agent_missions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) {
      console.error('[missions/delete] mission delete error:', error)
      return NextResponse.json({ error: 'Failed to delete mission' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[missions/delete] server error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
