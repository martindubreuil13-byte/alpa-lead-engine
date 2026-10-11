import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { getEffectiveResearchStatus } from '@/lib/commercial-intelligence/research-status'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Operator control of the DATABASE research switch (it takes effect at the next claim, with no redeploy). Administrators
// only; customers cannot reach it. The environment switch (CI_RESEARCH_ENABLED) stays a second, independent layer:
// research runs only when both are on. Turning the switch OFF is always allowed; it deletes nothing.
//   GET  -> read-only status (both switches, budgets, month spend, queue counts)
//   POST -> { "enabled": true | false }
export async function GET() {
  const profile = await getUserProfile()
  if (!profile || !isAdmin(profile)) return new Response('Unauthorized', { status: 401 })
  return NextResponse.json({ ok: true, status: await getEffectiveResearchStatus(createAdminClient() as any) })
}

export async function POST(request: Request) {
  const profile = await getUserProfile()
  if (!profile || !isAdmin(profile)) return new Response('Unauthorized', { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ ok: false, error: 'enabled must be true or false' }, { status: 400 })

  const admin = createAdminClient() as any
  const operator = (profile as { email?: string | null }).email || profile.id
  const { error } = await admin.rpc('set_ci_research_enabled', { p_enabled: body.enabled, p_operator: operator })
  if (error) return NextResponse.json({ ok: false, error: 'FAILED' }, { status: 500 })
  return NextResponse.json({ ok: true, status: await getEffectiveResearchStatus(admin) })
}
