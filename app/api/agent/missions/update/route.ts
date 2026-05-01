import { NextResponse } from 'next/server'

import { normalizeScheduleTime } from '@/lib/agent/schedule'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

const ALLOWED_STATUSES = ['draft', 'scheduled', 'active', 'paused', 'archived']
const ALLOWED_FIELDS = [
  'daily_target',
  'cta',
  'sender_signature',
  'location_input',
  'offer_input',
  'audience_input',
  'ctas',
  'next_run_at',
  'icp_expanded',
  'search_patterns',
  'name',
  'schedule_timezone',
  'schedule_local_time',
  'starts_at',
  'last_stop_reason',
] as const

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { missionId, status, schedule_time, timezone, ...fields } = body

    if (!missionId || typeof missionId !== 'string') {
      return NextResponse.json({ error: 'MISSING_MISSION_ID' }, { status: 400 })
    }

    const supabase = await createServerClient()
    const { userId, error: adminError } = await requireAdmin(supabase)
    if (adminError) return adminError

    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.id !== userId) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
    }

    const updatePayload: Record<string, unknown> = {}

    if (status !== undefined) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
      }
      updatePayload.status = status
    }

    if (schedule_time !== undefined && fields.schedule_local_time === undefined) {
      fields.schedule_local_time = schedule_time
    }

    if (timezone !== undefined && fields.schedule_timezone === undefined) {
      fields.schedule_timezone = timezone
    }

    if (body && Object.prototype.hasOwnProperty.call(body, 'name')) {
      updatePayload.name = body.name !== undefined ? body.name : undefined
    }

    for (const key of ALLOWED_FIELDS) {
      if (key === 'name') continue
      if (key in fields && fields[key] !== undefined) {
        updatePayload[key] =
          key === 'schedule_local_time'
            ? normalizeScheduleTime(String(fields[key] || ''))
            : fields[key]
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'NO_FIELDS_TO_UPDATE' }, { status: 400 })
    }

    updatePayload.updated_at = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('agent_missions')
      .update(updatePayload)
      .eq('id', missionId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[missions/update]', updateError)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }

    if (Array.isArray(fields.icp_expanded)) {
      const normalized = fields.icp_expanded
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 20)

      await supabase
        .from('agent_mission_icps')
        .delete()
        .eq('mission_id', missionId)
        .eq('user_id', user.id)

      if (normalized.length > 0) {
        const icpRows = normalized.map((label: string, index: number) => ({
          user_id: user.id,
          mission_id: missionId,
          label,
          query: label,
          position: index,
          is_active: true,
        }))

        const { error: icpError } = await supabase
          .from('agent_mission_icps')
          .insert(icpRows)

        if (icpError) {
          console.error('[missions/update] mission icp sync failed:', icpError)
          return NextResponse.json({ error: 'MISSION_ICP_SYNC_FAILED' }, { status: 500 })
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[missions/update]', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
