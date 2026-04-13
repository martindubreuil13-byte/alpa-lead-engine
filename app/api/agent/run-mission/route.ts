import { NextResponse } from 'next/server'

import { runMissionWithProspector } from '@/lib/agent/run-mission-with-prospector'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const { missionId } = await req.json()

    if (!missionId || typeof missionId !== 'string') {
      return NextResponse.json({ error: 'MISSING_MISSION_ID' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const { data: mission, error: missionError } = await supabase
      .from('agent_missions')
      .select('*')
      .eq('id', missionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (missionError) {
      console.error(missionError)
      return NextResponse.json({ error: 'MISSION_LOOKUP_FAILED' }, { status: 500 })
    }

    if (!mission) {
      return NextResponse.json({ error: 'MISSION_NOT_FOUND' }, { status: 404 })
    }

    const { data: icp, error: icpError } = await supabase
      .from('agent_icp')
      .select('*')
      .eq('id', mission.icp_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (icpError) {
      console.error(icpError)
      return NextResponse.json({ error: 'ICP_LOOKUP_FAILED' }, { status: 500 })
    }

    if (!icp) {
      return NextResponse.json({ error: 'ICP_NOT_FOUND' }, { status: 404 })
    }

    const summary = await runMissionWithProspector({
      supabase,
      mission,
      icp,
      userId: user.id,
    })

    return NextResponse.json({
      success: true,
      summary,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      {
        success: false,
        error: 'MISSION_RUN_FAILED',
        message: error instanceof Error ? error.message : 'Unknown mission error',
      },
      { status: 500 }
    )
  }
}
