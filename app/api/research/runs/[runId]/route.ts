import { NextResponse } from 'next/server'

import { getUserProfile } from '@/lib/auth/get-user-profile'
import { getEffectiveResearchStatus } from '@/lib/commercial-intelligence/research-status'
import {
  buildProfileCard,
  describeIntelligence,
  summarizeRun,
  toProfileReason,
  type ProfileCard,
  type RunProgressRow,
} from '@/lib/intelligence/run-progress'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'no-store' }

// Read-only. Returns the progress of one Discover run for the signed-in customer: the real state of every saved lead
// (from the database's own progress function, which row security restricts to the caller's own run), the profiles that
// are ready, and whether research is actually running. It never starts, claims or retries research. `latest` resolves
// to the customer's most recent run, so progress survives a refresh or a return visit with no browser state at all.
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })

  const { runId } = await context.params
  const supabase = await createServerClient()

  let id = runId
  if (runId === 'latest') {
    const { data } = await (supabase as any).from('ci_research_runs').select('run_id').order('created_at', { ascending: false }).limit(1)
    id = data?.[0]?.run_id ?? ''
    if (!id) return NextResponse.json({ ok: true, runId: null, stage: null, rows: [], profiles: {} }, { headers: NO_STORE })
  } else if (!UUID.test(runId)) {
    return NextResponse.json({ ok: false, error: 'INVALID_RUN' }, { status: 400, headers: NO_STORE })
  }

  const { data: rows, error } = await (supabase as any).rpc('get_ci_run_progress', { p_run_id: id })
  if (error) {
    // For example: the database function is not available yet. The customer's results are unaffected.
    return NextResponse.json({ ok: false, error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })
  }

  const progressRows = (rows ?? []) as RunProgressRow[]
  if (progressRows.length === 0) return NextResponse.json({ ok: true, runId: id, stage: null, rows: [], profiles: {} }, { headers: NO_STORE })

  const readyIds = progressRows.filter((row) => row.state === 'ready').map((row) => row.lead_id)
  const profiles: Record<string, ProfileCard> = {}
  if (readyIds.length > 0) {
    const { data: leads } = await supabase.from('leads').select('id, commercial_profile, website_snapshot, business_signals').in('id', readyIds)
    for (const lead of leads ?? []) {
      const card = buildProfileCard(lead)
      if (card) profiles[lead.id] = card
    }
  }

  const admin = createAdminClient() as any
  const status = await getEffectiveResearchStatus(admin)
  const summary = summarizeRun(progressRows)

  // Persisted timestamps for the stopwatch: the run's creation, and (once nothing is unresolved) the end of its last
  // job. The run id was just proven to be the caller's own by the progress read above.
  const { data: runRow } = await (supabase as any).from('ci_research_runs').select('created_at, cancelled_at').eq('run_id', id).maybeSingle()
  let endedAt: string | null = null
  if (runRow?.created_at && summary && summary.unresolved === 0) {
    const { data: lastJob } = await admin.from('commercial_intelligence_queue').select('completed_at').eq('run_id', id).not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(1)
    endedAt = lastJob?.[0]?.completed_at ?? runRow.cancelled_at ?? runRow.created_at
  }
  const timing = runRow?.created_at ? { startedAt: runRow.created_at as string, endedAt, serverNow: new Date().toISOString() } : null
  return NextResponse.json(
    {
      ok: true,
      runId: id,
      running: status.running,
      summary,
      stage: describeIntelligence(summary, status.running),
      timing,
      rows: progressRows.map((row) => ({ leadId: row.lead_id, state: row.state, reason: toProfileReason(row.state, row.last_error) })),
      profiles,
    },
    { headers: NO_STORE }
  )
}
