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

    // Count leads found today
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [
      leadsTodayResult,
      totalLeadsResult,
      emailsReadyResult,
      emailsApprovedResult,
      emailsRejectedResult,
      recentActivityResult,
      recentOutreachResult,
    ] = await Promise.all([
      supabase
        .from('agent_lead_queue')
        .select('id', { count: 'exact', head: true })
        .eq('mission_id', missionId)
        .gte('created_at', todayStart.toISOString()),

      supabase
        .from('agent_lead_queue')
        .select('id', { count: 'exact', head: true })
        .eq('mission_id', missionId),

      supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('mission_id', missionId)
        .eq('review_status', 'draft'),

      supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('mission_id', missionId)
        .eq('review_status', 'approved'),

      supabase
        .from('outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('mission_id', missionId)
        .eq('review_status', 'rejected'),

      supabase
        .from('agent_lead_queue')
        .select('id, business_name, website, email, location, created_at')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(20),

      supabase
        .from('outreach_queue')
        .select('id, company_name, review_status, created_at')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    return NextResponse.json({
      mission,
      leadsToday: leadsTodayResult.count ?? 0,
      totalLeads: totalLeadsResult.count ?? 0,
      emailsReady: emailsReadyResult.count ?? 0,
      emailsApproved: emailsApprovedResult.count ?? 0,
      emailsRejected: emailsRejectedResult.count ?? 0,
      recentActivity: recentActivityResult.data ?? [],
      recentOutreach: recentOutreachResult.data ?? [],
    })
  } catch (err) {
    console.error('[mission-status]', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
