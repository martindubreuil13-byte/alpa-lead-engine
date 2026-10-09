import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const ownerUserId = process.env.PRIVATE_ALPA_OWNER_USER_ID?.trim()
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!ownerUserId || !user?.id || user.id !== ownerUserId) {
    return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  }

  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id: unknown): id is string => typeof id === 'string'))].slice(0, 50)
    : []

  if (ids.length === 0) return NextResponse.json({ ok: true, data: [] })

  const { data, error } = await supabase
    .from('leads')
    .select('id, commercial_profile, ci_enrichment_status, ci_completed_at, ci_last_error')
    .eq('user_id', user.id)
    .in('id', ids)

  if (error) {
    console.error('[private-preview-research] read failed', { code: error.code })
    return NextResponse.json({ ok: false, error: 'READ_FAILED' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data: data || [] })
}
