import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const offerContextSchema = z.object({
  what_you_do: z.string(),
  who_you_help: z.string(),
  main_benefit: z.string(),
  angle: z.string(),
})

const requestSchema = z.object({
  offer_input: z.string().trim().min(1).max(1000),
  audience_input: z.string().trim().min(1).max(1000),
  location_input: z.string().trim().min(1).max(300),
  offer_context: offerContextSchema,
  icp_expanded: z.array(z.string()).min(1),
  search_patterns: z.array(z.string()).min(1),
})

export async function POST(req: Request) {
  try {
    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT', details: parsed.error.flatten() }, { status: 400 })
    }

    const {
      offer_input,
      audience_input,
      location_input,
      offer_context,
      icp_expanded,
      search_patterns,
    } = parsed.data

    // Create ICP record from expanded data so existing mission runner stays compatible
    const icpStructuredOutput = {
      target_businesses: icp_expanded.slice(0, 5),
      locations: [location_input],
      pain_points: [offer_context.main_benefit],
      messaging_angles: [offer_context.angle],
      summary: `Got it. I'll focus on ${offer_context.who_you_help}.`,
    }

    const { data: icp, error: icpError } = await supabase
      .from('agent_icp')
      .insert({
        user_id: userId,
        raw_input: offer_input,
        structured_output: icpStructuredOutput,
        status: 'active',
        is_active: true,
      })
      .select('id')
      .single()

    if (icpError || !icp) {
      console.error('[agent/confirm] icp insert error:', icpError)
      return NextResponse.json({ error: 'ICP_CREATE_FAILED' }, { status: 500 })
    }

    // Deactivate any previously active ICPs
    await supabase
      .from('agent_icp')
      .update({ is_active: false, status: 'draft' })
      .eq('user_id', userId)
      .neq('id', icp.id)

    // Create mission with full conversational context
    const { data: mission, error: missionError } = await supabase
      .from('agent_missions')
      .insert({
        user_id: userId,
        icp_id: icp.id,
        name: offer_context.what_you_do.slice(0, 120),
        status: 'active',
        leads_per_day: 10,
        daily_target: 10,
        contact_mode: 'email',
        require_email: true,
        require_phone: false,
        require_website: true,
        location: location_input,
        outreach_mode: 'draft_only',
        offer_input,
        audience_input,
        location_input,
        offer_context,
        icp_expanded,
        search_patterns,
      })
      .select('id')
      .single()

    if (missionError || !mission) {
      console.error('[agent/confirm] mission insert error:', missionError)
      return NextResponse.json({ error: 'MISSION_CREATE_FAILED' }, { status: 500 })
    }

    return NextResponse.json({ success: true, missionId: mission.id })
  } catch (error) {
    console.error('[agent/confirm] error:', error)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
