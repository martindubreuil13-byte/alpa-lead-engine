import { createClient } from '@supabase/supabase-js'

import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type TrackPayload = {
  session_id?: string
  event?: string
  email?: string
  query?: string
  location?: string
  leads_count?: number
  metadata?: Record<string, unknown>
}

function normalizeOptionalText(value: unknown) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function normalizeLeadsCount(value: unknown) {
  const count = Number(value)
  return Number.isFinite(count) ? count : null
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as TrackPayload

    const headerSessionId = req.headers.get('x-session-id')
    const sessionId =
      normalizeOptionalText(body.session_id) ||
      normalizeOptionalText(headerSessionId) ||
      crypto.randomUUID()
    const event = normalizeOptionalText(body.event)

    if (!event) {
      return Response.json({ success: true })
    }

    const authClient = await createServerClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const email = normalizeOptionalText(body.email) || normalizeOptionalText(user?.email)
    const payload = {
      session_id: sessionId,
      user_id: normalizeOptionalText(user?.id),
      email,
      event,
      query: normalizeOptionalText(body.query),
      location: normalizeOptionalText(body.location),
      leads_count: normalizeLeadsCount(body.leads_count),
      metadata:
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? body.metadata
          : null,
    }

    const { error } = await supabase
      .from('activity_logs')
      .insert(payload)

    if (error) {
      console.error('activity tracking insert failed:', error)
      return Response.json({ success: true })
    }

    if ((email || user?.id) && sessionId) {
      const updatePayload: { email?: string; user_id?: string } = {}
      if (email) updatePayload.email = email
      if (user?.id) updatePayload.user_id = user.id

      const { error: updateError } = await supabase
        .from('activity_logs')
        .update(updatePayload)
        .eq('session_id', sessionId)
        .or([email ? 'email.is.null' : null, user?.id ? 'user_id.is.null' : null].filter(Boolean).join(','))

      if (updateError) {
        console.error('activity tracking backfill failed:', updateError)
      }
    }
  } catch (error) {
    console.error('activity tracking failed:', error)
  }

  return Response.json({ success: true })
}
