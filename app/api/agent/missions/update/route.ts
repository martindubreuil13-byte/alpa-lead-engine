import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  try {
    const { missionId, status } = await req.json()

    if (!missionId || typeof missionId !== 'string') {
      return NextResponse.json({ error: 'MISSING_MISSION_ID' }, { status: 400 })
    }

    const allowedStatuses = ['active', 'paused', 'complete']
    if (!status || !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
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

    const { error: updateError } = await supabase
      .from('agent_missions')
      .update({ status })
      .eq('id', missionId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[missions/update]', updateError)
      return NextResponse.json({ error: 'UPDATE_FAILED' }, { status: 500 })
    }

    return NextResponse.json({ success: true, status })
  } catch (err) {
    console.error('[missions/update]', err)
    return NextResponse.json({ error: 'SERVER_ERROR' }, { status: 500 })
  }
}
