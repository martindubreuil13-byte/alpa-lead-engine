import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { reconcileExpiredRuns } from '@/lib/commercial-intelligence/run-reconciliation'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Operator-only. Closes jobs that never started in research runs that have expired (see run-reconciliation.ts). It is a dry run
// unless the body says {"confirm": true}; it is not scheduled anywhere and starts no research.
export async function POST(request: Request) {
  const profile = await getUserProfile()
  if (!profile || !isAdmin(profile)) return new Response('Unauthorized', { status: 401 })
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
  try {
    const result = await reconcileExpiredRuns(createAdminClient(), { dryRun: body?.confirm !== true })
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, error: 'UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
