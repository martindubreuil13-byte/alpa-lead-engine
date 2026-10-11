import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth/access'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { RESEARCH_DEADLINE_GRACE_MS, RESEARCH_BATCH_BUDGET_MS, RESEARCH_DEADLINE_MS } from '@/lib/commercial-intelligence/research-deadline'
import { describeResearchLimits } from '@/lib/commercial-intelligence/research-limits'
import { getResearchSwitchStatus } from '@/lib/commercial-intelligence/research-switch'
import { resolveWorkerConfig } from '@/lib/commercial-intelligence/worker-config'

export const runtime = 'nodejs'

// Read-only operator view: is research switched on, and what are its effective limits. It reads the
// server's environment only. It never starts research, never touches the queue and writes nothing.
export async function GET() {
  const profile = await getUserProfile()
  if (!profile || !isAdmin(profile)) return new Response('Unauthorized', { status: 401 })

  return NextResponse.json({
    ok: true,
    switch: getResearchSwitchStatus(),
    limits: describeResearchLimits(resolveWorkerConfig(), RESEARCH_DEADLINE_MS, RESEARCH_DEADLINE_GRACE_MS, RESEARCH_BATCH_BUDGET_MS),
  })
}
