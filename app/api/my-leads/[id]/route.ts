import { NextResponse } from 'next/server'

import { getUserProfile } from '@/lib/auth/get-user-profile'
import { fetchLeadDossier } from '@/lib/my-leads/list'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_STORE = { 'Cache-Control': 'no-store' }

// One business in full (contact details, notes and its Business Intelligence), loaded when a card is opened. Only the owner can
// read it; a missing id and someone else's id answer the same 404, so the endpoint never confirms that a lead exists.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })

  const { id } = await context.params
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: 'INVALID_ID' }, { status: 400, headers: NO_STORE })

  try {
    const dossier = await fetchLeadDossier(await createServerClient(), profile.id, id)
    if (!dossier) return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE })
    return NextResponse.json({ ok: true, lead: dossier }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })
  }
}
