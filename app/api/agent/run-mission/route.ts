import { NextResponse } from 'next/server'

import { runMissionWithProspector } from '@/lib/agent/run-mission-with-prospector'
import { syncAgentLeadsToMain } from '@/lib/agent/sync-agent-leads-to-main'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const EMPTY_SUMMARY = {
  discovered: 0,
  qualified: 0,
  rejected: 0,
  queued: 0,
  overflow: 0,
  inserted_to_leads: 0,
}

export async function POST(req: Request) {
  const startTime = Date.now()

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
      scrapeBaseUrl: process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin,
      cookieHeader: req.headers.get('cookie'),
    })

    console.log('SYNC START')
    const syncResult = await syncAgentLeadsToMain({
      supabase,
      userId: user.id,
      missionId: mission.id,
    })
    console.log('SYNC DONE')

    const summaryWithSync = {
      ...summary,
      inserted_to_leads: syncResult.inserted,
    }

    console.log('SYNC TO LEADS:', {
      missionId: mission.id,
      inserted: syncResult.inserted,
    })

    console.log('[api/agent/run-mission] completed', {
      missionId,
      userId: user.id,
      queued: summary.queued,
      inserted_to_leads: syncResult.inserted,
      elapsed: Date.now() - startTime,
    })
    console.log('MISSION COMPLETE')

    return NextResponse.json({
      success: true,
      summary: summaryWithSync,
    })
  } catch (error) {
    console.error(error)
    console.error('[api/agent/run-mission] failed', {
      elapsed: Date.now() - startTime,
    })
    console.log('MISSION COMPLETE')

    return NextResponse.json({
      success: true,
      summary: EMPTY_SUMMARY,
      warning: 'partial_failure_possible',
    })
  }
}
