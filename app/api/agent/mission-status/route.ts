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

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user || user.id !== userId) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const { data: mission, error: missionError } = await supabase
      .from('agent_missions')
      .select(
        'id, status, daily_target, offer_input, audience_input, location_input, location, name, created_at'
      )
      .eq('id', missionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (missionError || !mission) {
      return NextResponse.json({ error: 'MISSION_NOT_FOUND' }, { status: 404 })
    }

    // Count leads found today
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const { count: leadsToday } = await supabase
      .from('agent_lead_queue')
      .select('id', { count: 'exact', head: true })
      .eq('mission_id', missionId)
      .gte('created_at', todayStart.toISOString())

    // Count total leads for this mission
    const { count: totalLeads } = await supabase
      .from('agent_lead_queue')
      .select('id', { count: 'exact', head: true })
      .eq('mission_id', missionId)

    // Count emails ready (draft status in outreach queue)
    const { count: emailsReady } = await supabase
      .from('outreach_queue')
      .select('id', { count: 'exact', head: true })
      .eq('mission_id', missionId)
      .eq('status', 'draft')

    // Recent activity (last 20 leads)
    const { data: recentActivity } = await supabase
      .from('agent_lead_queue')
      .select('id, business_name, website, email, location, created_at')
      .eq('mission_id', missionId)
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      mission,
      leadsToday: leadsToday ?? 0,
      totalLeads: totalLeads ?? 0,
      emailsReady: emailsReady ?? 0,
      recentActivity: recentActivity ?? [],
    })
  } catch (err) {
    console.error('[mission-status]', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
