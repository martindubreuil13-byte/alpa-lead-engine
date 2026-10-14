import { after, NextResponse } from 'next/server'

import { getUserProfile } from '@/lib/auth/get-user-profile'
import { decideRetry, requeueFailedItem } from '@/lib/commercial-intelligence/retry-run-item'
import { kickResearch } from '@/lib/commercial-intelligence/kick-research'
import { RETRY_REFUSAL_TEXT } from '@/lib/intelligence/retry-eligibility'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A customer asks to retry ONE failed business profile of their own Discover run. It never repeats Discover or Contact
// Intelligence and consumes no lead allowance: it only puts that run's failed job back in the queue, and only if its own
// attempt allowance and every research budget would still permit a normal attempt. Counters are never reset and no limit
// is bypassed; the worker's claim checks them again before anything is reserved.
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { runId } = await context.params
  const body = (await request.json().catch(() => null)) as { leadId?: unknown } | null
  const leadId = typeof body?.leadId === 'string' ? body.leadId : ''
  if (!UUID.test(runId) || !UUID.test(leadId)) return NextResponse.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400 })

  // Row security proves the run is the caller's own and that this business is part of it.
  const { data: rows, error } = await (await createServerClient() as any).rpc('get_ci_run_progress', { p_run_id: runId })
  const row = (rows ?? []).find((item: { lead_id: string }) => item.lead_id === leadId)
  if (error || !row) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  if (row.state !== 'failed' && row.state !== 'partial') {
    return NextResponse.json({ ok: false, error: 'not_failed', message: RETRY_REFUSAL_TEXT.not_failed }, { status: 409 })
  }

  const admin = createAdminClient() as any
  const decision = await decideRetry(admin, { runId, leadId, userId: profile.id })
  if (!decision.ok) {
    return NextResponse.json({ ok: false, error: decision.reason, message: RETRY_REFUSAL_TEXT[decision.reason] }, { status: decision.reason === 'unavailable' ? 503 : 409 })
  }

  const requeued = await requeueFailedItem(admin, { runId, leadId, userId: profile.id, queueId: decision.queueId, retryCount: decision.retryCount, grant: decision.grant })
  if (!requeued) return NextResponse.json({ ok: false, error: 'already_requested', message: RETRY_REFUSAL_TEXT.already_requested }, { status: 409 })

  const origin = new URL(request.url).origin
  after(async () => { await kickResearch(origin) })
  return NextResponse.json({ ok: true })
}
