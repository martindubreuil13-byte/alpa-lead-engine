import { NextResponse } from 'next/server'

import { getUserProfile } from '@/lib/auth/get-user-profile'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A customer stops Business Intelligence for their own Discover run. The server performs the change: nothing new is
// claimed for the run, jobs that have not started are closed as cancelled, a job already running finishes and keeps its
// profile. It consumes no lead allowance and cannot touch another customer's run (the database checks ownership).
export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { runId } = await context.params
  if (!UUID.test(runId)) return NextResponse.json({ ok: false, error: 'INVALID_RUN' }, { status: 400 })

  const { data, error } = await (createAdminClient() as any).rpc('cancel_ci_research_run', { p_run_id: runId, p_user_id: profile.id })
  if (error) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ ok: true, result: data })
}
