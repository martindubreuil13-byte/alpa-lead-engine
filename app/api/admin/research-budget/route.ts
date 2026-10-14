import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { evaluateBudget, readMonthlyBudget } from '@/lib/commercial-intelligence/budget-alerts'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Operator view of this month's research spend against the global budget, with the 50% and 80% alert levels. Read-only: it sends
// nothing, schedules nothing and changes no limit.
export async function GET() {
  const profile = await getUserProfile()
  if (!profile || !isAdmin(profile)) return new Response('Unauthorized', { status: 401 })
  try {
    const budget = await readMonthlyBudget(createAdminClient())
    return NextResponse.json({ ok: true, budget: evaluateBudget(budget) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, error: 'UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
