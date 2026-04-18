import { after, NextResponse } from 'next/server'

import { executeMissionRun } from '@/lib/agent/mission-executor'
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

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== userId) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const { data: mission } = await supabase
      .from('agent_missions')
      .select('id, status')
      .eq('id', missionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!mission) {
      return NextResponse.json({ error: 'MISSION_NOT_FOUND' }, { status: 404 })
    }

    if (!['active', 'scheduled'].includes(mission.status)) {
      return NextResponse.json({ error: 'MISSION_NOT_RUNNABLE', status: mission.status }, { status: 409 })
    }

    after(async () => {
      await executeMissionRun({
        missionId,
        triggerType: 'manual',
        ignoreSchedule: true,
      })
    })

    return NextResponse.json({
      success: true,
      status: 'queued',
    })
  } catch (error) {
    console.error('[run-mission] error:', error)
    return NextResponse.json({ error: 'MISSION_FAILED' }, { status: 500 })
  }
}
