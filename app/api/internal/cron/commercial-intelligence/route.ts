import { NextResponse } from 'next/server'

import { runCommercialIntelligenceWorker } from '@/lib/commercial-intelligence/background-worker'
import { isCommercialIntelligenceCronAuthorized } from '@/lib/commercial-intelligence/cron-auth'
import { resolveWorkerConfig } from '@/lib/commercial-intelligence/worker-config'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  if (!isCommercialIntelligenceCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  try {
    const result = await runCommercialIntelligenceWorker(createAdminClient(), resolveWorkerConfig())

    console.log('[CI-BACKGROUND] Tick complete', {
      claimed: result.claimed,
      completed: result.completed,
      retrying: result.retrying,
      failed: result.failed,
      recovered: result.recovered,
      estimatedCost: result.estimatedCost,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error'
    console.error('[CI-BACKGROUND] Tick failed', { error: message })
    return NextResponse.json({ ok: false, error: 'WORKER_FAILED' }, { status: 500 })
  }
}
