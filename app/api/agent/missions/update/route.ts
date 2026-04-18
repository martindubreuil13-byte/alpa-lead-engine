import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

const ALLOWED_STATUSES = ['active', 'paused', 'completed', 'stopped', 'needs_review', 'exhausted', 'running']
const ALLOWED_FIELDS = [
  'daily_target',
  'cta',
  'sender_signature',
  'location_input',
  'offer_input',
  'audience_input',
  'next_run_at',
  'icp_expanded',
  'search_patterns',
  'name',
] as const

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { missionId, status, ...fields } = body

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

    for (const key of ALLOWED_FIELDS) {
      if (key in fields && fields[key] !== undefined) {
        updatePayload[key] = fields[key]
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'NO_FIELDS_TO_UPDATE' }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from('agent_missions')
      .update(updatePayload)
      .eq('id', missionId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[missions/update]', updateError)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[missions/update]', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
