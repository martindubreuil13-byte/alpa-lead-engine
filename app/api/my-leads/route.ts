import { NextResponse } from 'next/server'

import { getUserProfile } from '@/lib/auth/get-user-profile'
import { fetchLeadPage, parseListParams } from '@/lib/my-leads/list'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

// A page of the signed-in customer's saved businesses: search, filters, sorting and pagination happen in the database, and the
// response carries lightweight fields only (no stored profile, snapshot or signals). Customer session only: the client is the
// customer's own, so row security applies, and the query names the owner as well. No service-role access, no unbounded read.
export async function GET(request: Request) {
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })

  const parsed = parseListParams(new URL(request.url).searchParams)
  if (!parsed.ok) return NextResponse.json({ ok: false, error: 'INVALID_QUERY', message: parsed.message }, { status: 400, headers: NO_STORE })

  try {
    const page = await fetchLeadPage(await createServerClient(), profile.id, parsed.params)
    return NextResponse.json({ ok: true, ...page }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, error: 'UNAVAILABLE' }, { status: 503, headers: NO_STORE })
  }
}
