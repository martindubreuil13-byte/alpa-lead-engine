import { NextResponse } from 'next/server'

import { drainCommercialIntelligenceQueue } from '@/lib/commercial-intelligence/process-queue'
import { getUserProfile } from '@/lib/auth/get-user-profile'

export const runtime = 'nodejs'

export async function POST() {
  const startedAt = Date.now()

  try {
    console.log('[CI-CLIENT-TRIGGER] started')
    console.log('[CI-DIAG] endpoint entry POST /api/leads/process-commercial-intelligence-queue')

    const profile = await getUserProfile()
    if (!profile) {
      console.log('[CI-DIAG] early return reason=unauthenticated endpoint=process-commercial-intelligence-queue')
      console.log('[CI-CLIENT-TRIGGER] failed reason=unauthenticated')
      console.log(
        `[CI-DIAG] endpoint exit status=401 authenticated_user_id=null elapsed_ms=${Date.now() - startedAt}`
      )
      return NextResponse.json(
        {
          ok: false,
          error: 'Authentication required',
        },
        { status: 401 }
      )
    }

    console.log(`[CI-DIAG] after authentication authenticated_user_id=${profile.id}`)
    console.log(
      `[CI-DIAG] before drainCommercialIntelligenceQueue authenticated_user_id=${profile.id} batch_limit=3 max_batches=10 max_runtime_ms=55000`
    )
    const result = await drainCommercialIntelligenceQueue({
      batchLimit: 3,
      maxBatches: 10,
      maxRuntimeMs: 55_000,
      source: 'client-trigger',
    })
    console.log(
      `[CI-DIAG] after drainCommercialIntelligenceQueue authenticated_user_id=${profile.id} ok=${result.ok} claimed_or_processed_count=${result.totalProcessed} completed_count=${result.totalSucceeded} failed_count=${result.totalFailed} batches=${result.batches} stopping_reason=${result.stoppingReason} elapsed_ms=${Date.now() - startedAt}`
    )

    console.log(
      `[CI-CLIENT-TRIGGER] success user_id=${profile.id} processed=${result.totalProcessed} succeeded=${result.totalSucceeded} failed=${result.totalFailed} batches=${result.batches} stopping_reason=${result.stoppingReason} elapsed_ms=${Date.now() - startedAt}`
    )

    console.log(
      `[CI-DIAG] endpoint exit status=200 authenticated_user_id=${profile.id} processed=${result.totalProcessed} completed=${result.totalSucceeded} failed=${result.totalFailed} elapsed_ms=${Date.now() - startedAt}`
    )
    return NextResponse.json({
      ok: result.ok,
      processed: result.totalProcessed,
      succeeded: result.totalSucceeded,
      retrying: result.totalRetrying,
      failed: result.totalFailed,
      batches: result.batches,
      stoppingReason: result.stoppingReason,
      elapsedMs: result.elapsedMs,
      error: 'error' in result ? result.error : undefined,
    })
  } catch (err) {
    console.error('[CI-DIAG] caught exception endpoint=process-commercial-intelligence-queue', err, err instanceof Error ? err.stack : undefined)
    console.error('[CI-CLIENT-TRIGGER] failed', err, err instanceof Error ? err.stack : undefined)
    console.log(
      `[CI-DIAG] endpoint exit status=500 authenticated_user_id=unknown elapsed_ms=${Date.now() - startedAt}`
    )

    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
