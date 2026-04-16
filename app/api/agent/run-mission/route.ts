import { NextResponse, after } from 'next/server'

import { runMission } from '@/lib/agent/run-mission'
import { syncAgentLeadsToMain } from '@/lib/agent/sync-agent-leads-to-main'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'
import type { TrialLead } from '@/lib/trial'

export const runtime = 'nodejs'

function buildDedupKey(lead: { email?: string | null; website?: string | null }) {
  const email = String(lead.email || '').trim().toLowerCase()
  if (email) return email
  return String(lead.website || '').trim().toLowerCase()
}

async function persistLeads(params: {
  supabase: Awaited<ReturnType<typeof createServerClient>>
  missionId: string
  icpId: string
  userId: string
  leads: TrialLead[]
}) {
  const { supabase, missionId, icpId, userId, leads } = params
  if (!leads.length) return

  try {
    const { data: existingRows } = await supabase
      .from('agent_lead_queue')
      .select('email, website')
      .eq('user_id', userId)
      .eq('mission_id', missionId)

    const existingKeys = new Set(
      (existingRows || []).map(buildDedupKey).filter(Boolean)
    )

    const newLeads = leads.filter((lead) => {
      const key = buildDedupKey(lead)
      if (!key) return true
      if (existingKeys.has(key)) return false
      existingKeys.add(key)
      return true
    })

    if (newLeads.length > 0) {
      const { error: insertError } = await supabase.from('agent_lead_queue').insert(
        newLeads.map((lead) => ({
          user_id: userId,
          mission_id: missionId,
          icp_id: icpId,
          business_name: lead.company_name,
          website: lead.website,
          email: lead.email,
          phone: lead.phone,
          location: lead.city ?? null,
          qualification_status: 'qualified',
          context_status: 'pending',
          draft_status: 'pending',
        }))
      )
      if (insertError) {
        console.error('[run-mission] queue insert error (ignored):', insertError)
      }
    }

    await syncAgentLeadsToMain({ supabase, userId, missionId })
  } catch (err) {
    console.error('[run-mission] persist error (ignored):', err)
  }
}

export async function POST(req: Request) {
  const startTime = Date.now()

  try {
    const { missionId } = await req.json()

    if (!missionId || typeof missionId !== 'string') {
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
      .select('*')
      .eq('id', missionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (missionError) {
      console.error('[run-mission] mission lookup error:', missionError)
      return NextResponse.json({ error: 'MISSION_LOOKUP_FAILED' }, { status: 500 })
    }

    if (!mission) {
      return NextResponse.json({ error: 'MISSION_NOT_FOUND' }, { status: 404 })
    }

    // ICP is optional — missions created via new setup flow may use search_patterns directly
    let icp = null
    if (mission.icp_id) {
      const { data: icpData, error: icpError } = await supabase
        .from('agent_icp')
        .select('*')
        .eq('id', mission.icp_id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (icpError) {
        console.error('[run-mission] icp lookup error:', icpError)
        return NextResponse.json({ error: 'ICP_LOOKUP_FAILED' }, { status: 500 })
      }

      icp = icpData
    }

    if (!icp && !mission.search_patterns) {
      return NextResponse.json({ error: 'MISSION_HAS_NO_SEARCH_CONFIG' }, { status: 400 })
    }

    const result = await runMission({
      supabase,
      mission,
      icp,
      scrapeBaseUrl: process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin,
      cookieHeader: req.headers.get('cookie'),
    })

    after(async () => {
      await persistLeads({
        supabase,
        missionId: mission.id,
        icpId: icp?.id ?? mission.icp_id ?? '',
        userId: user.id,
        leads: result.leads,
      })
    })

    console.log('[run-mission] complete', {
      missionId,
      found: result.found,
      withEmail: result.withEmail,
      elapsed: Date.now() - startTime,
    })

    return NextResponse.json({
      success: true,
      leads: result.leads,
      found: result.found,
      withEmail: result.withEmail,
      readyToContact: result.readyToContact,
      query: result.query,
      location: result.location,
    })
  } catch (err) {
    console.error('[run-mission] error:', err, { elapsed: Date.now() - startTime })
    return NextResponse.json({ error: 'MISSION_FAILED' }, { status: 500 })
  }
}
