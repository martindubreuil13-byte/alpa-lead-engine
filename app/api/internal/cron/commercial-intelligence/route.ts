import { after, NextResponse } from 'next/server'

import { runCommercialIntelligenceWorker } from '@/lib/commercial-intelligence/background-worker'
import { isCommercialIntelligenceCronAuthorized } from '@/lib/commercial-intelligence/cron-auth'
import { dispatchResearchTick, parseDepth, shouldContinue } from '@/lib/commercial-intelligence/kick-research'
import { isResearchEnabled } from '@/lib/commercial-intelligence/research-switch'
import { resolveWorkerConfig } from '@/lib/commercial-intelligence/worker-config'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

// One research tick. Two modes, both behind the same secret and the same operator switch:
//   default      the tick runs now and its result is returned (operator and manual use)
//   ?async=1     the request is acknowledged with 202 at once and the tick runs after the response, in this invocation, within
//                its 300 s limit (the tick itself stops at 240 s). If it stopped on its own limits with jobs still being
//                claimed, it dispatches the next tick, one link deeper; the chain is capped, so it cannot run away.
// Whatever the mode, the database decides what may be claimed: switch, allow-list, run scope, budgets, two at a time per
// customer, one claim per job. Overlapping ticks therefore cannot process a job twice or exceed the concurrency.
export async function GET(request: Request) {
  if (!isCommercialIntelligenceCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  // Emergency switch (default OFF): checked before the database is touched, so a stopped system claims,
  // recovers and changes nothing. Queued jobs and stored profiles stay exactly as they are.
  if (!isResearchEnabled()) {
    return NextResponse.json({ ok: true, disabled: true, claimed: 0 })
  }

  const url = new URL(request.url)

  if (url.searchParams.get('async') === '1') {
    const depth = parseDepth(url.searchParams.get('depth'))
    const origin = url.origin
    after(async () => {
      try {
        const result = await runCommercialIntelligenceWorker(createAdminClient(), resolveWorkerConfig())
        console.log('[CI-BACKGROUND] Tick complete', {
          depth,
          claimed: result.claimed,
          completed: result.completed,
          failed: result.failed,
          recovered: result.recovered,
          moreWork: result.moreWork,
          estimatedCost: result.estimatedCost,
        })
        if (shouldContinue({ depth, moreWork: result.moreWork, disabled: 'disabled' in result && Boolean(result.disabled) })) {
          await dispatchResearchTick(origin, { depth: depth + 1 })
        }
      } catch (error) {
        console.error('[CI-BACKGROUND] Tick failed', { depth, error: error instanceof Error ? error.message : 'Unknown worker error' })
      }
    })
    return NextResponse.json({ ok: true, accepted: true, depth }, { status: 202 })
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
