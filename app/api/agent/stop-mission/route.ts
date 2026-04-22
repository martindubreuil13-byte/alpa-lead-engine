import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const missionId = typeof body?.missionId === 'string' ? body.missionId : ''

    if (!missionId) {
      return NextResponse.json({ error: 'MISSING_MISSION_ID' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const { data: mission, error: missionError } = await supabase
      .from('agent_missions')
      .select('id')
      .eq('id', missionId)
      .eq('user_id', userId)
      .maybeSingle()

    if (missionError || !mission) {
      return NextResponse.json({ error: 'MISSION_NOT_FOUND' }, { status: 404 })
    }

    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('agent_missions')
      .update({
        status: 'paused',
        next_run_at: null,
        last_stop_reason: 'stopped_by_user',
        updated_at: now,
      })
      .eq('id', missionId)
      .eq('user_id', userId)

    if (updateError) {
      console.error('[stop-mission] update failed:', updateError)
      return NextResponse.json({ error: 'STOP_FAILED' }, { status: 500 })
    }

    console.log('[stop] mission marked as stopped', missionId)

    await supabase
      .from('agent_mission_runs')
      .update({
        status: 'cancelled',
        finished_at: now,
        updated_at: now,
      })
      .eq('mission_id', missionId)
      .eq('user_id', userId)
      .in('status', ['queued', 'running'])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[stop-mission] error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
