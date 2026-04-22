import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const missionId = searchParams.get('missionId')

    if (!missionId) {
      return NextResponse.json({ error: 'MISSING_MISSION_ID' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const { data: mission, error: missionError } = await supabase
      .from('agent_missions')
      .select('*')
      .eq('id', missionId)
      .eq('user_id', userId)
      .maybeSingle()

    if (missionError || !mission) {
      console.error('[mission-status] not found:', { missionId, userId, missionError })
      return NextResponse.json({ error: 'MISSION_NOT_FOUND' }, { status: 404 })
    }

    // Fetch the latest run first so we can scope activity queries to that run.
    const { data: rawRun, error: runError } = await supabase
      .from('agent_mission_runs')
      .select(`
        id,
        mission_id,
        status,
        started_at,
        completed_at,
        finished_at,
        leads_requested,
        leads_found,
        leads_accepted,
        leads_deduped,
        drafts_generated,
        accepted_count,
        drafts_generated_count,
        error,
        created_at,
        updated_at
      `)
      .eq('mission_id', missionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (runError) {
      console.error('[RUN FETCH ERROR]', runError)
      return NextResponse.json({ mission, latestRun: null })
    }

    const latestRun = rawRun
      ? {
          ...rawRun,
          accepted_count: rawRun.accepted_count ?? 0,
          drafts_generated_count: rawRun.drafts_generated_count ?? 0,
          leads_found: rawRun.leads_found ?? 0,
          leads_accepted: rawRun.leads_accepted ?? 0,
          leads_deduped: rawRun.leads_deduped ?? 0,
          drafts_generated: rawRun.drafts_generated ?? 0,
        }
      : null
    const runId = latestRun?.id ?? null

    // All queries scoped to the current run where possible.
    const [
      totalLeadsResult,
      recentActivityResult,
      recentOutreachResult,
    ] = await Promise.all([
      supabase
        .from('agent_lead_queue')
        .select('id', { count: 'exact', head: true })
        .eq('mission_id', missionId),

      supabase
        .from('agent_lead_queue')
        .select('id, business_name, website, email, location, created_at')
        .eq(runId ? 'run_id' : 'mission_id', runId ?? missionId)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('outreach_queue')
        .select('id, company_name, review_status, created_at')
        .eq(runId ? 'run_id' : 'mission_id', runId ?? missionId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    return NextResponse.json({
      mission,
      totalLeads:     totalLeadsResult.count  ?? 0,
      recentActivity: recentActivityResult.data ?? [],
      recentOutreach: recentOutreachResult.data ?? [],
      latestRun,
    })
  } catch (err) {
    console.error('[mission-status]', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
