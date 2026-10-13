import { NextResponse } from 'next/server'

import { buildFeedbackMetadata, FEEDBACK_EVENT, parseFeedbackInput, readStoredFeedback } from '@/lib/guest/feedback'
import { sameOrigin } from '@/lib/guest/security'
import { guestDb, guestSession, loadGuestSession } from '@/lib/guest/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

// The one-question feedback for a free trial. One row per trial in the existing analytics table (event "trial_feedback"); the
// visitor's signed trial cookie (or, signed in, the trial linked to their account) is the only identity. No email, no account is
// required, nothing is sent to the visitor, and a trial can answer or correct its answer only a handful of times.

async function findRow(trialId: string) {
  const { data, error } = await guestDb()
    .from('activity_logs')
    .select('id, metadata')
    .eq('event', FEEDBACK_EVENT)
    .eq('metadata->>trial_id', trialId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data && data[0]) as { id: string; metadata: unknown } | undefined
}

/** What this visitor has already answered, so a refresh does not ask again. Nothing about a trial that does not exist. */
export async function GET() {
  try {
    const id = await guestSession()
    if (!id) return NextResponse.json({ feedback: null }, { headers: NO_STORE })
    const row = await findRow(id)
    const stored = row ? readStoredFeedback(row.metadata) : null
    return NextResponse.json({ feedback: stored ? { answer: stored.answer, hasComment: Boolean(stored.comment) } : null }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ feedback: null }, { headers: NO_STORE })
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Request origin refused' }, { status: 403, headers: NO_STORE })

  const parsed = parseFeedbackInput(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400, headers: NO_STORE })

  try {
    // The signed trial cookie decides which trial this is; nothing in the request names one.
    const id = await guestSession()
    if (!id) return NextResponse.json({ error: 'Your free trial was not found.' }, { status: 401, headers: NO_STORE })
    let trial: Awaited<ReturnType<typeof loadGuestSession>>
    try {
      trial = await loadGuestSession(id)
    } catch {
      return NextResponse.json({ error: 'This trial has expired.' }, { status: 410, headers: NO_STORE })
    }
    const saved = Array.isArray(trial.leads) ? trial.leads.length : 0
    if (saved === 0) return NextResponse.json({ error: 'There is nothing to give feedback on yet.' }, { status: 400, headers: NO_STORE })

    const auth = await createSupabaseServerClient()
    const {
      data: { user },
    } = await auth.auth.getUser()

    const existing = await findRow(id)
    const built = buildFeedbackMetadata(
      existing?.metadata ?? null,
      parsed.input,
      { trialId: id, savedBusinesses: saved, searches: Number(trial.attempts) || 0, businessesUsed: Number(trial.used) || 0, trialCreatedAt: trial.created_at ?? null, signedIn: Boolean(user?.id) }
    )
    if (!built.ok) return NextResponse.json({ error: 'Thanks. We already have your feedback.' }, { status: 429, headers: NO_STORE })

    const db = guestDb()
    if (existing) {
      const { error } = await db.from('activity_logs').update({ metadata: built.metadata, leads_count: saved }).eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await db.from('activity_logs').insert({
        session_id: parsed.input.analyticsSessionId ?? id,
        user_id: user?.id ?? null,
        email: null,
        event: FEEDBACK_EVENT,
        query: null,
        location: null,
        leads_count: saved,
        metadata: built.metadata,
      })
      if (error) throw error
    }
    return NextResponse.json({ ok: true, feedback: { answer: parsed.input.answer, hasComment: Boolean(built.metadata.has_comment) } }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'Your feedback could not be saved right now.' }, { status: 503, headers: NO_STORE })
  }
}
