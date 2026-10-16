import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/auth/require-admin'
import { createServerClient } from '@/lib/supabase/server'
import { loadCostReport } from '@/lib/costs/load'
import { isValidTimeZone, resolveRange } from '@/lib/costs/report'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { error: denied } = await requireAdmin(await createServerClient())
  if (denied) return denied

  const params = new URL(request.url).searchParams
  const resolved = resolveRange({ preset: params.get('range'), from: params.get('from'), to: params.get('to'), tz: params.get('tz') })
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400, headers: { 'Cache-Control': 'no-store' } })

  const requestedTz = params.get('tz')
  const tz = requestedTz && isValidTimeZone(requestedTz) ? requestedTz : 'UTC'
  try {
    const result = await loadCostReport(resolved.range, tz)
    return NextResponse.json(
      { ...result, range: { from: resolved.range.from.toISOString(), to: resolved.range.to.toISOString(), days: resolved.range.days } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json({ state: 'error', message: 'The cost figures could not be loaded.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
