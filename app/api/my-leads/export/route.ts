import { NextResponse } from 'next/server'

import { getUserProfile } from '@/lib/auth/get-user-profile'
import { EXPORT_MAX, fetchLeadsForExport } from '@/lib/my-leads/list'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'no-store' }

// The rows behind "Export CSV" for the businesses the customer selected (up to 500), so the list itself stays lightweight.
// Customer session only; an id that is not the customer's own is silently left out.
export async function POST(request: Request) {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
  const ids = Array.isArray(body?.ids) ? body.ids : null
  if (!ids || ids.length === 0 || ids.length > EXPORT_MAX || !ids.every((id): id is string => typeof id === 'string' && UUID.test(id))) {
    return NextResponse.json({ ok: false, error: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE })
  }

  try {
    const leads = await fetchLeadsForExport(await createServerClient(), profile.id, ids)
    return NextResponse.json({ ok: true, leads }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })
  }
}
