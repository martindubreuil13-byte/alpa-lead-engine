import { NextResponse } from 'next/server'
import { processCommercialIntelligenceQueue } from '@/lib/commercial-intelligence/process-queue'
import { getUserProfile } from '@/lib/auth/get-user-profile'
import { getAdaptiveBatchSize, describeBatchSize } from '@/lib/commercial-intelligence/adaptive-batch-size'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes per request (worker calls repeatedly)

export async function POST() {
  const startedAt = Date.now()

  try {
    const profile = await getUserProfile()
    if (!profile) {
      console.log('[CI-BATCH] Unauthorized: no authenticated user')
      return NextResponse.json(
        { ok: false, error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Get current pending count to determine batch size
    const supabase = await createServerClient()
    const { count: pendingCount } = await supabase
      .from('commercial_intelligence_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .in('status', ['pending', 'processing'])

    const batchSize = getAdaptiveBatchSize(pendingCount || 0)

    console.log(
      `[CI-BATCH] Processing batch for user: ${profile.id}, pending=${pendingCount}, batch_size=${describeBatchSize(pendingCount || 0)}`
    )

    // Process one batch of items with adaptive size
    const result = await processCommercialIntelligenceQueue({
      limit: batchSize,
      source: 'worker-batch',
    })

    const elapsedMs = Date.now() - startedAt
    console.log(
      `[CI-BATCH] Complete: processed=${result.processed} succeeded=${result.succeeded} retrying=${result.retrying} failed=${result.failed} elapsed_ms=${elapsedMs}`
    )

    return NextResponse.json({
      ok: result.ok,
      processed: result.processed,
      succeeded: result.succeeded,
      retrying: result.retrying,
      failed: result.failed,
      recovered: result.recovered,
      stats: result.stats,
      elapsedMs,
      message: result.message,
      batchSize,
    })
  } catch (err) {
    const elapsedMs = Date.now() - startedAt
    console.error('[CI-BATCH] Error:', err)
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        elapsedMs,
      },
      { status: 500 }
    )
  }
}
