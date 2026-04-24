import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  console.log('[MISSION DELETE BODY]', body)
  const missionId = body?.missionId || body?.id

  if (!missionId || typeof missionId !== 'string') {
    console.log('[MISSION DELETE FAILED]', { reason: 'MISSING_MISSION_ID' })
    return NextResponse.json({ error: 'Missing mission id' }, { status: 400 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    console.error('[MISSION DELETE ERROR]', userError)
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const userId = user?.id

  if (!userId) {
    console.log('[MISSION DELETE FAILED]', { missionId, reason: 'UNAUTHORIZED' })
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }

  console.log('[MISSION DELETE START]', { missionId, userId })

  const { data, error } = await supabase
    .from('agent_missions')
    .delete()
    .eq('id', missionId)
    .eq('user_id', userId)
    .select('id')

  if (error) {
    console.error('[MISSION DELETE ERROR]', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  if (!data || data.length === 0) {
    console.log('[MISSION DELETE FAILED]', { missionId, userId, reason: 'MISSION_NOT_DELETED' })
    return NextResponse.json({ error: 'Mission not deleted' }, { status: 400 })
  }

  console.log('[MISSION DELETE SUCCESS]', { missionId, userId, deletedCount: data.length })

  return NextResponse.json({ success: true })
}
