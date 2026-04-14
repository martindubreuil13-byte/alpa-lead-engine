import { createClient } from '@supabase/supabase-js'

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
    console.log('🔥 TRACK API HIT')
    console.log('BODY:', body)

    const headerSessionId = req.headers.get('x-session-id')
    const sessionId =
      normalizeOptionalText(body.session_id) ||
      normalizeOptionalText(headerSessionId) ||
      crypto.randomUUID()
    const event = normalizeOptionalText(body.event)

    if (!event) {
      return Response.json({ success: true })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const email = normalizeOptionalText(body.email)
    const payload = {
      session_id: sessionId,
      user_id: null,
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

    const { data, error } = await supabase
      .from('activity_logs')
      .insert(payload)
      .select()

    console.log('INSERT RESULT:', { data, error })

    if (error) {
      console.error('activity tracking insert failed:', error)
      return Response.json({ success: true })
    }

    if (email && sessionId) {
      const { error: updateError } = await supabase
        .from('activity_logs')
        .update({ email })
        .eq('session_id', sessionId)
        .is('email', null)

      if (updateError) {
        console.error('activity tracking email backfill failed:', updateError)
      }
    }
  } catch (error) {
    console.error('activity tracking failed:', error)
  }

  return Response.json({ success: true })
}
