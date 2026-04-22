import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

async function safeDelete(query: PromiseLike<{ error: { message?: string } | null }>, label: string) {
  try {
    const { error } = await query
    if (error) {
      console.warn(`[DELETE WARNING] ${label}`, error.message)
    }
  } catch (error) {
    console.warn(
      `[DELETE WARNING] ${label}`,
      error instanceof Error ? error.message : String(error)
    )
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const missionId = body?.id

    if (!missionId || typeof missionId !== 'string') {
      return NextResponse.json({ error: 'Missing mission id' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.id) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const userId = user.id

    console.log('[MISSION DELETE]', missionId)

    await safeDelete(
      supabase.from('outreach_queue')
        .delete()
        .eq('mission_id', missionId)
        .eq('user_id', userId),
      'outreach_queue'
    )

    await safeDelete(
      supabase.from('leads')
        .delete()
        .eq('mission_id', missionId)
        .eq('user_id', userId),
      'leads'
    )

    await safeDelete(
      supabase.from('agent_lead_queue')
        .delete()
        .eq('mission_id', missionId)
        .eq('user_id', userId),
      'agent_lead_queue'
    )

    await safeDelete(
      supabase.from('agent_mission_runs')
        .delete()
        .eq('mission_id', missionId)
        .eq('user_id', userId),
      'agent_mission_runs'
    )

    await safeDelete(
      supabase.from('agent_mission_icps')
        .delete()
        .eq('mission_id', missionId)
        .eq('user_id', userId),
      'agent_mission_icps'
    )

    await safeDelete(
      supabase.from('agent_missions')
        .delete()
        .eq('id', missionId)
        .eq('user_id', userId),
      'agent_missions'
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.warn(
      '[DELETE WARNING] mission delete route',
      error instanceof Error ? error.message : String(error)
    )
    return NextResponse.json({ success: true })
  }
}
